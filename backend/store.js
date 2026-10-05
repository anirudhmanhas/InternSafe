'use strict';

/**
 * Tiny JSON-file storage.
 *
 * Why a JSON file and not SQLite? There is nothing to install or configure,
 * it works the same on Windows and on a free host, and the data is small.
 * Limits: one server process only, and free hosts may reset the file on
 * redeploy. That is fine for a hackathon demo.
 *
 * Privacy: we NEVER store the pasted offer text. We store only counters
 * (how many checks, how many per level, how often each red flag appeared)
 * and short, sanitised report snippets.
 */

const fs = require('fs');
const path = require('path');

const MAX_REPORTS = 1000; // oldest reports are dropped after this

function emptyData() {
  return {
    totalChecked: 0,
    levels: { Low: 0, Medium: 0, High: 0 },
    flagCounts: {},
    reports: [],
  };
}

class Store {
  constructor(file) {
    this.file = file;
    this.data = this._load();
  }

  _load() {
    try {
      if (!fs.existsSync(this.file)) return emptyData();
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const base = emptyData();
      return {
        totalChecked: Number(parsed.totalChecked) || 0,
        levels: { ...base.levels, ...(parsed.levels || {}) },
        flagCounts: parsed.flagCounts || {},
        reports: Array.isArray(parsed.reports) ? parsed.reports : [],
      };
    } catch (err) {
      // A broken file must never stop the server. Start fresh.
      return emptyData();
    }
  }

  _save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file); // write-then-rename so the file is never half written
  }

  /** Count one analysis. Only numbers are stored, never the text. */
  recordAnalysis(result) {
    this.data.totalChecked += 1;
    this.data.levels[result.level] += 1;
    for (const flag of result.flags) {
      this.data.flagCounts[flag.id] = (this.data.flagCounts[flag.id] || 0) + 1;
    }
    this._save();
  }

  addReport({ snippet, flags, level }) {
    this.data.reports.push({ snippet, flags, level, createdAt: new Date().toISOString() });
    if (this.data.reports.length > MAX_REPORTS) {
      this.data.reports.splice(0, this.data.reports.length - MAX_REPORTS);
    }
    this._save();
  }

  getStats(ruleNames) {
    const { totalChecked, levels, flagCounts, reports } = this.data;
    const topFlags = Object.entries(flagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => ({ id, name: ruleNames[id] || id, count }));
    return {
      totalChecked,
      totalReported: reports.length,
      levels: { ...levels },
      highRiskShare: totalChecked ? Number((levels.High / totalChecked).toFixed(3)) : 0,
      topFlags,
    };
  }
}

module.exports = { Store, MAX_REPORTS };
