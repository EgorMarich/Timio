const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

function localDateToUtcMidnight(date, timezone) {
  const [year, month, day] = date.split("-").map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(guess);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second));
  return new Date(guess.getTime() - (asUtc - guess.getTime()));
}

const cases = [
  ["2026-09-15", "Europe/Moscow", "2026-09-14T21:00:00.000Z"],
  ["2026-09-15", "Europe/Stockholm", "2026-09-14T22:00:00.000Z"],
  ["2026-09-15", "Asia/Tokyo", "2026-09-14T15:00:00.000Z"],
  ["2026-09-15", "America/New_York", "2026-09-15T04:00:00.000Z"],
];

for (const [date, timezone, expected] of cases) {
  assert(localDateToUtcMidnight(date, timezone).toISOString() === expected, `${date} ${timezone} conversion failed`);
}

console.log(`Timezone audit passed: ${cases.length} cases`);
