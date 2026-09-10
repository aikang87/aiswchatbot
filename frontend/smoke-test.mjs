import { chromium } from "playwright";

const BASE = "http://localhost:5173";
const consoleErrors = [];

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

console.log("=== 1. Chat 페이지 로드 ===");
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector("h1");
const title = await page.textContent("h1");
console.log("title:", title);

console.log("=== 2. 분야 내 질문 전송 ===");
await page.fill('input[placeholder="메시지를 입력하세요"]', "하이테크과정 나이 제한이 어떻게 되나요?");
await page.click('button:has-text("보내기")');
await page.waitForFunction(
  () => {
    const bubbles = document.querySelectorAll("div.whitespace-pre-wrap");
    return bubbles.length >= 2 && bubbles[1].textContent.length > 5;
  },
  { timeout: 30000 },
);
await page.waitForTimeout(500);
const bubbleTexts = await page.$$eval("div.whitespace-pre-wrap", (els) => els.map((e) => e.textContent));
console.log("bubbles:", bubbleTexts);

console.log("=== 3. 출처 보기 클릭 ===");
const citeButton = await page.$('button:has-text("출처")');
if (citeButton) {
  await citeButton.click();
  await page.waitForTimeout(300);
  const citeVisible = await page.$eval("ul", (el) => el.textContent).catch(() => null);
  console.log("citations shown:", citeVisible ? "yes" : "no");
} else {
  console.log("citations button not found!");
}

console.log("=== 4. 피드백 버튼 클릭 (스트리밍 완료 대기) ===");
try {
  await page.waitForSelector('button[aria-label="도움이 됐어요"]', { timeout: 15000 });
  await page.click('button[aria-label="도움이 됐어요"]');
  console.log("feedback clicked ok");
} catch {
  console.log("thumbs up button not found!");
}

console.log("=== 5. 분야 외 질문(차단) 전송 ===");
await page.fill('input[placeholder="메시지를 입력하세요"]', "오늘 서울 날씨 어때요?");
await page.click('button:has-text("보내기")');
await page.waitForFunction(() => document.body.textContent.includes("답변 범위를 벗어난"), { timeout: 30000 });
console.log("blocked notice shown: yes");

console.log("=== 6. Admin 로그인 ===");
await page.goto(`${BASE}/admin/login`, { waitUntil: "networkidle" });
await page.fill('input[type="email"]', "admin@example.com");
await page.fill('input[type="password"]', "admin1234");
await page.click('button:has-text("로그인")');
await page.waitForURL(/\/admin\/conversations/, { timeout: 10000 });
console.log("admin login ok, url:", page.url());

console.log("=== 7. Conversations 목록 ===");
await page.waitForSelector("table");
const rowCount = await page.$$eval("tbody tr", (rows) => rows.length);
console.log("conversation rows:", rowCount);

console.log("=== 8. 대화 상세 페이지 ===");
const firstLink = await page.$("tbody tr a");
if (firstLink) {
  await firstLink.click();
  await page.waitForTimeout(500);
  console.log("detail url:", page.url());
}

console.log("=== 9. Gaps 페이지 ===");
await page.goto(`${BASE}/admin/gaps`, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
const gapCount = await page.$$eval("button:has-text('FAQ로 승격')", (els) => els.length);
console.log("gap clusters with promote button:", gapCount);

console.log("=== 10. Knowledge 페이지 ===");
await page.goto(`${BASE}/admin/knowledge`, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
const knowledgeCount = await page.$$eval("button:has-text('수정')", (els) => els.length);
console.log("knowledge items:", knowledgeCount);

console.log("=== 11. Stats 페이지 ===");
await page.goto(`${BASE}/admin/stats`, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
const statTiles = await page.$$eval("h1 ~ div > div", (els) => els.length);
console.log("stat area rendered:", statTiles > 0);

console.log("=== 12. Settings 페이지 ===");
await page.goto(`${BASE}/admin/settings`, { waitUntil: "networkidle" });
await page.waitForSelector("textarea");
console.log("settings textarea present: yes");

console.log("\n=== console errors ===");
console.log(consoleErrors.length ? consoleErrors : "none");

await browser.close();
