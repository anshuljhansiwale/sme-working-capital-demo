import puppeteer from "puppeteer-core";

const base = process.env.DEMO_URL || "http://127.0.0.1:3000";
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const page = await browser.newPage();
page.setDefaultTimeout(15000);
const failures = [];

function check(name, ok, detail = "") {
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
  else console.log(`ok ${name}`);
}

async function text(selector) {
  return page.$eval(selector, (node) => node.textContent).catch(() => "");
}

async function body() {
  return page.evaluate(() => document.body.innerText);
}

async function click(selector) {
  await page.waitForSelector(selector, { visible: true });
  await page.click(selector);
}

async function status(expected) {
  await page.waitForFunction((value) => document.querySelector("#case-status")?.textContent === value, {}, expected);
  const error = await text("#error");
  if (error) throw new Error(error);
}

async function shot(name) {
  await page.screenshot({ path: `/tmp/${name}.png`, fullPage: true });
}

try {
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(base, { waitUntil: "networkidle0" });
  check("banner", (await text("#synthetic-banner")).includes("not a customer"));
  check("four paths", await page.$$eval("#switcher button", (nodes) => nodes.map((node) => node.id).join(",")) === "path-WC-1001,path-WC-1002,path-WC-1003,path-WC-1004");
  check("no outcome control", (await page.$$("select")).length === 0);
  check("model note", (await text("#model-call")).includes("fixture response"));
  check("model id", (await text("#model-id")).includes("grok-4.7"));

  await click('button[data-action="intake"][data-source="file-drop"]');
  await status("Received");
  check("1001 received name", (await text("#legal-name")).includes("Bramble Forge"));
  check("1001 bureau hidden before policy", !(await body()).includes("760"));
  await click('button[data-action="check-documents"]');
  await status("Checking policy");
  await click('button[data-action="start-policy"]');
  await page.waitForFunction(() => document.querySelector("#policy-outcome")?.textContent === "Approve");
  check("1001 bureau read onto the case", (await body()).includes("760") && (await body()).includes("Read by the Risk & Policy bot"));
  await click('button[data-action="finalize"]');
  await status("Decision final");
  await click('button[data-action="write-back"]');
  await status("Written back");
  const approve = await body();
  check("1001 reference", approve.includes("LOS-DEMO-1001"));
  check("1001 no model memo", approve.includes("No model memo"));
  check("1001 skipped seats", approve.includes("Not required"));
  await shot("wc-1001-written-back");

  await click("#path-WC-1002");
  await page.waitForFunction(() => document.querySelector("#legal-name")?.textContent.includes("Saltwharf"));
  check("switch stays on one page", page.url().includes("#WC-1002"));
  check("1002 sample is not Bramble", !(await text("#legal-name")).includes("Bramble"));
  await click('button[data-action="intake"][data-source="file-drop"]');
  await status("Received");
  check("email does not count", (await body()).includes("An email is not a received document."));
  await click('button[data-action="check-documents"]');
  await status("Awaiting documents");
  const gaps = await body();
  check("chase names both gaps", gaps.includes("Bank statements, last six months") && gaps.includes("Aged debtors and creditors"));
  check("sla date", gaps.includes("SLA due"));
  check("policy blocked", gaps.includes("Blocked"));
  check("bureau unread", gaps.includes("not read"));
  await click('button[data-action="start-policy"]');
  await page.waitForFunction(() => document.querySelector("#notice")?.textContent.includes("bureau fixture was not read"));
  check("policy still stopped", (await text("#case-status")) === "Awaiting documents");
  check("no bureau snapshot on 1002", !(await body()).includes("Read by the Risk & Policy bot"));
  await shot("wc-1002-chase");

  await click("#path-WC-1003");
  await page.waitForFunction(() => document.querySelector("#legal-name")?.textContent.includes("Kiln"));
  await click('button[data-action="intake"][data-source="file-drop"]');
  await status("Received");
  await click('button[data-action="check-documents"]');
  await status("Checking policy");
  await click('button[data-action="start-policy"]');
  await page.waitForFunction(() => document.querySelector("#policy-outcome")?.textContent === "Escalate");
  check("reason codes", (await body()).includes("POL_DSCR") && (await body()).includes("POL_EXPOSURE") && (await body()).includes("GATE_HIGH_VALUE"));
  await click('#strip-actions button[data-action="select-build"][data-mode="landed"]');
  await status("Pending maker");
  await click("#insert-context");
  const memo = await page.$eval("#memo", (node) => node.value);
  check("context sentence", memo.includes("not a waiver of the debt-service rule"));
  await click('button[data-action="maker-confirm"]');
  await status("Pending checker");
  check("model draft kept", (await text("#model-memo")).includes("debt-service shortfall") || (await body()).includes("debt-service shortfall"));
  await click("#seat-checker");
  await click('button[data-action="checker-confirm"]');
  await status("Decision final");
  check("outcome still escalate", (await text("#policy-outcome")) === "Escalate");
  await click('button[data-action="write-back"]');
  await status("Written back");
  const escalated = await body();
  check("1003 reference", escalated.includes("LOS-DEMO-1003"));
  check("final memo kept", escalated.includes("not a waiver of the debt-service rule"));
  check("fallback no", escalated.includes("No"));
  await shot("wc-1003-audit");

  await click("#path-WC-1001");
  await page.waitForFunction(() => document.querySelector("#legal-name")?.textContent.includes("Bramble"));
  check("1001 audit did not pick up 1003", (await body()).includes("LOS-DEMO-1001") && !(await body()).includes("LOS-DEMO-1003"));

  await click("#path-WC-1004");
  await page.waitForFunction(() => document.querySelector("#legal-name")?.textContent.includes("Paperhill"));
  await click('button[data-action="intake"][data-source="file-drop"]');
  await status("Received");
  await click('button[data-action="check-documents"]');
  await status("Checking policy");
  await click('button[data-action="start-policy"]');
  await page.waitForFunction(() => document.querySelector("#policy-outcome")?.textContent === "Decline");
  await click('button[data-action="open-maker"]');
  await status("Pending maker");
  check("template memo", (await text("#model-memo")).includes("POL_INTERNAL_SCORE") || (await body()).includes("POL_INTERNAL_SCORE"));
  await click("#seat-maker");
  await click('button[data-action="maker-confirm"]');
  await status("Decision final");
  check("no checker on 1004", (await text("#case-status")) === "Decision final");
  await click('button[data-action="write-back"]');
  await status("Written back");
  check("1004 reference", (await body()).includes("LOS-DEMO-1004"));
  await shot("wc-1004-decline");

  await click("#path-WC-1003");
  await page.waitForFunction(() => document.querySelector("#case-status")?.textContent === "Written back");
  await click('button[data-action="reset"]');
  await page.waitForFunction(() => !document.querySelector("#case-status"));
  await click('button[data-action="intake"][data-source="file-drop"]');
  await status("Received");
  await click('button[data-action="check-documents"]');
  await status("Checking policy");
  await click('button[data-action="start-policy"]');
  await page.waitForFunction(() => document.querySelector("#policy-outcome")?.textContent === "Escalate");
  await click('#strip-actions button[data-action="time-box"]');
  await page.waitForFunction(() => document.body.innerText.includes("CHECKIN_FAILED"));
  await click('#strip-actions button[data-action="select-build"][data-mode="last-green"]');
  await status("Pending maker");
  check("fallback recorded", (await body()).includes("FALLBACK_BUILD_USED"));
  check("fallback yes", (await body()).includes("Yes"));
  await shot("wc-1003-fallback");

  await page.setViewport({ width: 390, height: 844 });
  await click("#path-WC-1002");
  await page.waitForFunction(() => document.querySelector("#legal-name")?.textContent.includes("Saltwharf"));
  await shot("wc-1002-mobile");
  check("mobile still one page", page.url().includes("#WC-1002"));

  await page.setViewport({ width: 1280, height: 900 });
  await click("#path-WC-1001");
  await page.waitForFunction(() => document.querySelector("#case-status")?.textContent === "Written back");
  await click('button[data-action="reset"]');
  await page.waitForFunction(() => !document.querySelector("#case-status"));
  await click('button[data-action="intake"][data-source="simulated-los-webhook"]');
  await status("Received");
  check("webhook source", (await body()).includes("simulated LOS webhook"));
  check("webhook same applicant", (await text("#legal-name")).includes("Bramble Forge"));
} catch (error) {
  failures.push(error.stack || error.message);
  await shot("walkthrough-error").catch(() => {});
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(failures.join("\n\n"));
  process.exit(1);
}
console.log("walkthrough passed");
