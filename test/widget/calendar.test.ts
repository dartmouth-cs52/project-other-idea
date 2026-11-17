import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeBrowser, point, start, words } from "./harness.ts";

after(closeBrowser);

// A calendar that opens from a field, the way Ant Design draws one: a panel
// put at the end of the page that the keyboard can reach, with no pointer of
// its own, around a table of days that each show the pointer. Before, the
// panel was listed as one control and a pick was told as the panel's words.

const days = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);
const week = (dates: number[]) => `<tr>${dates.map((date) => `<td title="2026-11-${String(date).padStart(2, "0")}" style="cursor:pointer;padding:4px"><div>${date}</div></td>`).join("")}</tr>`;
const PAGE = `<h1>Booking</h1><input id="date" placeholder="Select date" autocomplete="off">
<p id="out"></p>
<script>
  const field = document.getElementById("date");
  field.addEventListener("click", () => {
    if (document.getElementById("panel")) return;
    const panel = document.createElement("div");
    panel.id = "panel";
    panel.tabIndex = 0;
    panel.style.cssText = "position:absolute;left:24px;top:110px;background:#fff;border:1px solid #999;padding:8px";
    panel.innerHTML = '<div><button type="button">Nov</button><button type="button">2026</button></div>' +
      '<table><thead><tr><th>Su</th><th>Mo</th><th>Tu</th><th>We</th><th>Th</th><th>Fr</th><th>Sa</th></tr></thead><tbody>' +
      ${JSON.stringify([days(1, 7), days(8, 14), days(15, 21), days(22, 28)].map(week).join(""))} + '</tbody></table>';
    panel.addEventListener("click", (event) => {
      const cell = event.target.closest("td");
      if (!cell) return;
      field.value = cell.title;
      panel.remove();
      document.getElementById("out").textContent = "Booked.";
    });
    document.body.append(panel);
  });
</script>`;

test("a day picked in a calendar that a field opened is told as that day, not as the calendar's words", async () => {
  const session = await start(PAGE, (request, index) => (index === 0 ? point(request, "Select date", "Click the date field and pick a day.") : words("Done.")));
  try {
    await session.ask("book the 15th");
    await session.untilState("pointing");
    await session.page.locator("#date").click();
    await session.page.locator("#panel").waitFor();
    await session.page.waitForTimeout(400);
    await session.page.locator('td[title="2026-11-15"] div').click();
    const second = await session.untilAsked(2, 8000);
    assert.match(second.event ?? "", /"15"/, second.event ?? "");
    assert.doesNotMatch(second.event ?? "", /Su ?Mo/, second.event ?? "");
  } finally {
    await session.close();
  }
});
