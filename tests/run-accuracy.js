'use strict';

/**
 * Runs every sample in tests/samples.json through the detector and prints
 * accuracy, false positives and false negatives.
 *
 * Run:  node tests/run-accuracy.js          (summary + failures)
 *       node tests/run-accuracy.js --verbose (also show the flags per sample)
 *
 * A sample is predicted "scam" when its level is Medium or High
 * (score >= THRESHOLDS.medium). This protects students: when in doubt, warn.
 */

const path = require('path');
const { analyze, THRESHOLDS } = require('../backend/detector');
const samples = require(path.join(__dirname, 'samples.json'));

const verbose = process.argv.includes('--verbose');
const pad = (s, n) => String(s).padEnd(n);

let correct = 0;
const falsePositives = []; // genuine offers wrongly flagged (score >= medium)
const falseNegatives = []; // scams wrongly passed (score < medium)
let genuineRatedHigh = 0;

console.log('InternSafe detector accuracy');
console.log('Predicted scam = score >= ' + THRESHOLDS.medium + ' (Medium or High)\n');
console.log(pad('ID', 6) + pad('Label', 9) + pad('Score', 7) + pad('Level', 8) + 'Result');
console.log('-'.repeat(40));

for (const s of samples) {
  const result = analyze({ text: s.text, link: s.link, company: s.company, sender: s.sender });
  const predictedScam = result.score >= THRESHOLDS.medium;
  const isScam = s.label === 'scam';
  const ok = predictedScam === isScam;

  if (ok) correct++;
  else if (isScam) falseNegatives.push({ s, result });
  else falsePositives.push({ s, result });
  if (!isScam && result.level === 'High') genuineRatedHigh++;

  console.log(
    pad(s.id, 6) + pad(s.label, 9) + pad(result.score, 7) + pad(result.level, 8) + (ok ? 'OK' : 'WRONG')
  );
  if (verbose) {
    for (const f of result.flags) {
      console.log('        - ' + f.id + ' (' + f.weight + '): ' + f.matches.map((m) => '"' + m.phrase + '"').join(', '));
    }
  }
}

const total = samples.length;
const scams = samples.filter((s) => s.label === 'scam').length;
console.log('\n=== Summary ===');
console.log('Total samples      : ' + total + ' (' + scams + ' scam, ' + (total - scams) + ' genuine)');
console.log('Correct            : ' + correct + ' / ' + total);
console.log('Accuracy           : ' + ((correct / total) * 100).toFixed(1) + '%');
console.log('False positives    : ' + falsePositives.length + ' (genuine flagged Medium/High)');
console.log('  of which High    : ' + genuineRatedHigh);
console.log('False negatives    : ' + falseNegatives.length + ' (scam rated Low)');

for (const { s, result } of falsePositives) {
  console.log('\n[False positive] ' + s.id + ' score ' + result.score + ' -> ' + result.flags.map((f) => f.id).join(', '));
}
for (const { s, result } of falseNegatives) {
  console.log('\n[False negative] ' + s.id + ' score ' + result.score + ' -> ' + (result.flags.map((f) => f.id).join(', ') || 'no flags'));
}
console.log(
  '\nNote: these samples were written by the developer, so the accuracy is optimistic. ' +
    'Add real offers (from friends or news) to samples.json before quoting a final number.'
);
