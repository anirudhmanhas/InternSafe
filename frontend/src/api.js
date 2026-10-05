// One small helper for every call to our backend.
export async function api(path, body) {
  let res;
  try {
    res = await fetch('/api' + path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : undefined);
  } catch {
    throw new Error('Cannot reach the server. Check that it is running.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || 'Something went wrong. Try again.');
  return data;
}
