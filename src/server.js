import express from "express";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveBuild } from "./builds.js";
import { closeDb, getDb } from "./db.js";
import { buildFixtures } from "./fixtures.js";
import { invokeGrok } from "../exception-service/grok.js";
import { composeResponse } from "../exception-service/respond.js";
import {
  CaseError,
  checkDocuments,
  confirmChecker,
  confirmMaker,
  finalizeStraightThrough,
  intake,
  openMaker,
  present,
  resetCase,
  selectBuild,
  startPolicy,
  timeBoxElapsed,
  writeBack,
} from "./orchestrator.js";
import {
  CURRENCY,
  DSCR_MINIMUM,
  EXPOSURE_CAP,
  HIGH_VALUE_ABOVE,
  POLICY_VERSION,
  PRODUCT,
  SCORE_APPROVE,
  SCORE_DECLINE_BELOW,
  SLA_BUSINESS_DAYS,
  SYNTHETIC_MARKER,
  TENOR_MAX,
  TENOR_MIN,
} from "./policy.js";
import { CONTEXT_SENTENCE } from "./memos.js";

const root = dirname(fileURLToPath(import.meta.url));

export const publicPolicy = {
  version: POLICY_VERSION,
  currency: CURRENCY,
  highValueAbove: HIGH_VALUE_ABOVE,
  exposureCap: EXPOSURE_CAP,
  dscrMinimum: DSCR_MINIMUM,
  scoreApprove: SCORE_APPROVE,
  scoreDeclineBelow: SCORE_DECLINE_BELOW,
  tenorMin: TENOR_MIN,
  tenorMax: TENOR_MAX,
  slaBusinessDays: SLA_BUSINESS_DAYS,
  product: PRODUCT,
  syntheticMarker: SYNTHETIC_MARKER,
  contextSentence: CONTEXT_SENTENCE,
};

function clean(doc) {
  if (!doc) return doc;
  const copy = { ...doc };
  delete copy._id;
  return copy;
}

function publicFixture(fixture) {
  const copy = clean(fixture);
  if (copy.caseId !== "WC-1002") {
    delete copy.bureau;
    delete copy.internalScore;
    delete copy.debtServiceCover;
    delete copy.sanctionsFlag;
  }
  return copy;
}

async function seed(db) {
  for (const fixture of buildFixtures()) {
    await db.collection("fixtures").replaceOne({ caseId: fixture.caseId }, fixture, { upsert: true });
  }
}

function caseIdOf(value) {
  if (!/^WC-\d{4}$/.test(value ?? "")) throw new CaseError(400, "Case id must look like WC-1001.");
  return value;
}

async function callExceptionService(baseUrl, request) {
  const response = await fetch(`${baseUrl}/exception-service/advise`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Exception service failed.");
  return body;
}

export async function createApp({ checkGitHub = true } = {}) {
  const db = await getDb();
  await seed(db);
  const build = await resolveBuild({ checkGitHub });
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "1mb" }));

  app.post("/exception-service/advise", async (req, res, next) => {
    try {
      const modelDraft = await invokeGrok(req.body, { apiKey: process.env.XAI_API_KEY, fetchImpl: fetch });
      res.json(composeResponse(req.body, { modelDraft }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/state", async (req, res, next) => {
    try {
      const fixtures = await db.collection("fixtures").find({ rehearsalOnly: { $in: [true, false] } }).sort({ caseId: 1 }).toArray();
      const cases = await db.collection("cases").find({}).sort({ caseId: 1 }).toArray();
      const live = new Set(["WC-1001", "WC-1002", "WC-1003", "WC-1004"]);
      res.json({
        policy: publicPolicy,
        build,
        fixtures: fixtures.filter((fixture) => live.has(fixture.caseId)).map(publicFixture),
        cases: cases.filter((entry) => live.has(entry.caseId)).map((entry) => present(clean(entry))),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/cases/:caseId", async (req, res, next) => {
    try {
      const caseId = caseIdOf(req.params.caseId);
      const caseDoc = await db.collection("cases").findOne({ caseId }, { projection: { _id: 0 } });
      if (!caseDoc) throw new CaseError(404, `No case ${caseId} has been received.`);
      res.json({ case: present(caseDoc) });
    } catch (error) {
      next(error);
    }
  });

  const routes = [
    ["post", "/api/cases/:caseId/intake", async (req) => intake(db, caseIdOf(req.params.caseId), req.body?.source)],
    ["post", "/api/cases/:caseId/check-documents", async (req) => checkDocuments(db, caseIdOf(req.params.caseId))],
    ["post", "/api/cases/:caseId/finalize", async (req) => finalizeStraightThrough(db, caseIdOf(req.params.caseId))],
    ["post", "/api/cases/:caseId/open-maker", async (req) => openMaker(db, caseIdOf(req.params.caseId))],
    ["post", "/api/cases/:caseId/time-box", async (req) => timeBoxElapsed(db, caseIdOf(req.params.caseId), undefined, build)],
    ["post", "/api/cases/:caseId/maker", async (req) => confirmMaker(db, caseIdOf(req.params.caseId), req.body ?? {})],
    ["post", "/api/cases/:caseId/checker", async (req) => confirmChecker(db, caseIdOf(req.params.caseId), req.body ?? {})],
    ["post", "/api/cases/:caseId/write-back", async (req) => writeBack(db, caseIdOf(req.params.caseId))],
    ["post", "/api/cases/:caseId/reset", async (req) => resetCase(db, caseIdOf(req.params.caseId))],
  ];

  for (const [method, path, handler] of routes) {
    app[method](path, async (req, res, next) => {
      try {
        const result = await handler(req);
        if (result?.blocked) res.json({ blocked: true, message: "Policy did not start. The bureau fixture was not read.", case: result.case });
        else if (result?.reset) res.json(result);
        else res.json({ case: result });
      } catch (error) {
        next(error);
      }
    });
  }

  app.post("/api/cases/:caseId/start-policy", async (req, res, next) => {
    try {
      const result = await startPolicy(db, caseIdOf(req.params.caseId));
      res.json({
        blocked: result.blocked,
        message: result.blocked ? "Policy did not start. The bureau fixture was not read." : null,
        case: result.case,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/cases/:caseId/select-build", async (req, res, next) => {
    try {
      const caseId = caseIdOf(req.params.caseId);
      const baseUrl = req.app.locals.baseUrl || `http://${req.get("host")}`;
      const result = await selectBuild(db, caseId, {
        mode: req.body?.mode,
        build,
        callService: (request) => callExceptionService(baseUrl, request),
      });
      res.json({ case: result });
    } catch (error) {
      next(error);
    }
  });

  app.use(express.static(join(root, "../public")));

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const status = error.status || 500;
    res.status(status).json({ error: error.message || "The demo could not complete that step." });
  });

  return { app, db, build };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const port = Number(process.env.PORT || 3000);
  const { app, build } = await createApp();
  const server = app.listen(port, "0.0.0.0", () => {
    const address = server.address();
    app.locals.baseUrl = `http://127.0.0.1:${address.port}`;
    console.log(`SME working-capital demo at http://localhost:${address.port}`);
    console.log(`Policy ${build.repository ? POLICY_VERSION : POLICY_VERSION}. Last green commit ${build.commit}. Green bar ${build.green ? "passed" : "failed"}.`);
    console.log(build.apiKeyPresent
      ? `Grok model ${build.modelId} will be called.`
      : `Grok model ${build.modelId} is wired. No API key is set, so the exception service returns the fixture response.`);
  });

  const shutdown = async () => {
    server.close();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
