/** Two business days, Monday to Friday, UTC. No holiday calendar. */
export function addBusinessDays(start, days) {
  const date = new Date(start);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date");
  let left = days;
  while (left > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return date.toISOString().slice(0, 10);
}
