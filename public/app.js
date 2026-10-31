const PATHS = [
  { id: "WC-1001", title: "Straight-through Approve", room: "Played first" },
  { id: "WC-1002", title: "Missing documents", room: "Played second" },
  { id: "WC-1003", title: "Exception, high value", room: "Played third" },
  { id: "WC-1004", title: "Decline", room: "Rehearsal only. Not a live script." },
];

const app = document.querySelector("#app");
let state = { fixtures: [], cases: [], build: null, policy: null };
let selected = PATHS.some((path) => path.id === location.hash.slice(1)) ? location.hash.slice(1) : "WC-1001";
let seat = "maker";
let memoKey = "";
let memoOverride = null;
let errorText = "";
let noticeText = "";
let busy = false;

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  if (tag === "textarea") node.value = node.textContent;
  return node;
}

function money(amount, currency = "USD") {
  if (amount == null) return "—";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(amount)} ${currency}`;
}

function cover(value) {
  if (value == null) return "—";
  return Number(value).toFixed(2);
}

function when(value) {
  if (!value) return "—";
  return value.replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

function fixtureFor(id) {
  return state.fixtures.find((fixture) => fixture.caseId === id) ?? null;
}

function caseFor(id) {
  return state.cases.find((entry) => entry.caseId === id) ?? null;
}

function startingMemo(caseDoc) {
  if (!caseDoc) return "";
  if (caseDoc.modelMemo?.body) return `${caseDoc.modelMemo.headline}\n\n${caseDoc.modelMemo.body}`;
  return caseDoc.templateMemo || "";
}

function memoValue(caseDoc) {
  const key = `${caseDoc?.caseId ?? ""}:${caseDoc?.status ?? ""}:${caseDoc?.modelMemo?.memoId ?? "template"}`;
  if (key !== memoKey) {
    memoKey = key;
    memoOverride = null;
  }
  return memoOverride ?? startingMemo(caseDoc);
}

async function load() {
  const response = await fetch("/api/state");
  if (!response.ok) throw new Error("The demo state could not be loaded.");
  state = await response.json();
}

async function act(caseId, path, body) {
  errorText = "";
  noticeText = "";
  busy = true;
  render();
  try {
    const response = await fetch(`/api/cases/${caseId}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "That step was refused.");
    if (data.blocked) noticeText = data.message;
    if (data.reset) noticeText = `${caseId} was reset. Drop the file to play it again.`;
    await load();
  } catch (error) {
    errorText = error.message;
  } finally {
    busy = false;
    render();
  }
}

function choose(id) {
  selected = id;
  history.replaceState(null, "", `#${id}`);
  errorText = "";
  noticeText = "";
  render();
}

function onMemoInput(event) {
  memoOverride = event.target.value;
}

function insertContext() {
  const sentence = state.policy?.contextSentence;
  const area = document.querySelector("#memo");
  if (!area || !sentence) return;
  if (!area.value.includes(sentence)) {
    area.value = `${area.value.trim()}\n\n${sentence}`;
  }
  memoOverride = area.value;
}

function bureauBlock(fixture, caseDoc) {
  if (caseDoc?.bureauSnapshot) {
    return el("div", {}, [
      el("h3", {}, ["Bureau, score, and debt-service cover"]),
      el("p", {}, [`Read by the Risk & Policy bot at ${when(caseDoc.bureauSnapshot.pullTime)}.`]),
      el("dl", {}, [
        el("dt", {}, ["Band"]),
        el("dd", {}, [caseDoc.bureauSnapshot.band]),
        el("dt", {}, ["Delinquencies"]),
        el("dd", {}, [String(caseDoc.bureauSnapshot.delinquencyCount)]),
        el("dt", {}, ["Fixture reference"]),
        el("dd", {}, [caseDoc.bureauSnapshot.fixtureReference]),
        el("dt", {}, ["Internal score"]),
        el("dd", {}, [String(caseDoc.internalScore)]),
        el("dt", {}, ["Debt-service cover"]),
        el("dd", {}, [cover(caseDoc.debtServiceCover)]),
      ]),
    ]);
  }
  if (fixture?.caseId === "WC-1002") {
    return el("div", {}, [
      el("h3", {}, ["Bureau fixture on file — not read"]),
      el("p", {}, ["The file exists. The policy bot has not copied it onto the case."]),
      el("dl", {}, [
        el("dt", {}, ["Band"]),
        el("dd", {}, [fixture.bureau.band]),
        el("dt", {}, ["Note"]),
        el("dd", {}, [fixture.bureau.delinquencyNote]),
        el("dt", {}, ["Fixture reference"]),
        el("dd", {}, [fixture.bureau.fixtureReference]),
        el("dt", {}, ["Internal score"]),
        el("dd", {}, [String(fixture.internalScore)]),
        el("dt", {}, ["Debt-service cover"]),
        el("dd", {}, [cover(fixture.debtServiceCover)]),
      ]),
    ]);
  }
  return el("p", { class: "note" }, ["Bureau, internal score, and debt-service cover appear here after the policy bot reads them."]);
}

function documentTable(rows, caption) {
  return el("div", {}, [
    el("h3", {}, [caption]),
    el("table", {}, [
      el("thead", {}, [el("tr", {}, ["Document", "Required", "Present"].map((label) => el("th", {}, [label])))]),
      el("tbody", {}, rows.map((doc) => el("tr", {}, [
        el("td", {}, [doc.type + (doc.gapCode === "GAP_PURPOSE" ? " (application field, not a separate file)" : "")]),
        el("td", {}, [doc.required ? "Yes" : "No"]),
        el("td", { class: doc.present ? "pass" : "fail" }, [doc.present ? "Present" : "Missing"]),
      ]))),
    ]),
  ]);
}

function samplePanel(fixture, caseDoc) {
  const facts = caseDoc ?? fixture;
  if (!facts) return el("section", { class: "sample", id: "sample" }, [el("h2", {}, ["Sample data"]), el("p", {}, ["No fixture."])]);
  const documentsOnCase = caseDoc?.documents?.length ? caseDoc.documents : null;
  const emails = caseDoc ? caseDoc.emails : fixture.emails;
  return el("section", { class: "sample", id: "sample" }, [
    el("h2", {}, ["Sample data"]),
    el("p", { class: "note" }, [caseDoc ? "Facts stored on the case." : "Fixture file. Not received yet."]),
    el("dl", {}, [
      el("dt", {}, ["Legal name"]),
      el("dd", { id: "legal-name" }, [facts.legalName]),
      el("dt", {}, ["Years trading"]),
      el("dd", {}, [String(facts.yearsTrading)]),
      el("dt", {}, ["Facility"]),
      el("dd", {}, [money(facts.facilityAmount, facts.currency)]),
      el("dt", {}, ["Tenor"]),
      el("dd", {}, [`${facts.tenorMonths} months`]),
      el("dt", {}, ["Purpose"]),
      el("dd", {}, [facts.purpose]),
      el("dt", {}, ["Existing exposure"]),
      el("dd", {}, [money(facts.existingExposure, facts.currency)]),
    ]),
    documentsOnCase
      ? documentTable(documentsOnCase, "Documents on the case")
      : documentTable(fixture.documents, "Documents in the fixture file"),
    el("h3", {}, ["Application comments"]),
    el("p", {}, [facts.applicationComments || "None."]),
    el("h3", {}, ["Emails"]),
    emails?.length
      ? el("div", {}, emails.map((email) => el("article", { class: "event" }, [
        el("div", { class: "when" }, [`${email.fromRole} · ${email.subject} · ${when(email.time)}`]),
        el("p", {}, [email.body]),
        el("p", { class: "note" }, ["An email is not a received document."]),
      ])))
      : el("p", {}, ["No emails."]),
    bureauBlock(fixture, caseDoc),
  ]);
}

function workflowBar(steps) {
  return el("ol", { class: "workflow", id: "workflow" }, steps.map((step) => el("li", { class: `step ${step.state}` }, [
    el("div", { class: "k" }, [step.state]),
    el("strong", {}, [step.label]),
    step.result ? el("div", { class: `result ${step.result}` }, [step.result]) : null,
    step.holder ? el("div", { class: "note" }, [step.holder]) : null,
  ])));
}

function actionPanel(fixture, caseDoc) {
  const actions = caseDoc?.actions ?? [
    { id: "intake", source: "file-drop", label: "Drop case file" },
    { id: "intake", source: "simulated-los-webhook", label: "Simulated LOS webhook" },
  ];
  const primary = actions.filter((action) => action.id !== "reset");
  const reset = actions.find((action) => action.id === "reset");
  const buttons = primary.map((action) => {
    const needsMaker = action.id === "maker-confirm";
    const needsChecker = action.id === "checker-confirm";
    const wrongSeat = (needsMaker && seat !== "maker") || (needsChecker && seat !== "checker");
    return el("button", {
      "data-action": action.id,
      "data-mode": action.mode || null,
      "data-source": action.source || null,
      disabled: busy || wrongSeat,
      class: action.id === "time-box" ? "secondary" : null,
      onclick: () => runAction(fixture.caseId, action),
    }, [wrongSeat ? `${action.label} (${needsMaker ? "maker" : "checker"} seat)` : action.label]);
  });

  const children = [
    el("h2", {}, ["Workflow"]),
    caseDoc
      ? el("p", {}, [`Status `, el("strong", { id: "case-status" }, [caseDoc.status]), ". The orchestrator is the only actor that moves it."])
      : el("p", {}, ["Nothing has been received on this path. Drop the case file, or send the simulated LOS webhook once."]),
  ];

  if (caseDoc?.policyOutcome) {
    children.push(el("p", {}, [
      "Policy outcome ",
      el("strong", { id: "policy-outcome" }, [caseDoc.policyOutcome]),
      ". Reason codes ",
      caseDoc.reasonCodes.join(", "),
      ". The outcome is read-only.",
    ]));
  }
  if (caseDoc?.policyChecks?.length) {
    children.push(checkTable(caseDoc.policyChecks));
  }
  if (caseDoc?.chaseState === "Open") {
    children.push(el("h3", {}, ["Chase"]));
    children.push(el("p", {}, [`SLA due ${caseDoc.slaDue}.`]));
    children.push(el("pre", { class: "readonly", id: "chase-text" }, [caseDoc.chaseText]));
  }
  if (caseDoc?.status === "Pending maker") {
    children.push(makerEditor(caseDoc));
  }
  if (caseDoc?.status === "Pending checker") {
    children.push(el("p", {}, ["Checker seat. Confirm the memo. There is no control that replaces the outcome."]));
    children.push(el("pre", { class: "readonly" }, [caseDoc.finalMemo]));
  }
  children.push(el("div", { class: "actions" }, buttons));
  if (!caseDoc) {
    children.push(el("div", {
      class: "drop",
      id: "drop-zone",
      ondragover: (event) => event.preventDefault(),
      ondrop: onDrop,
    }, ["Or drop a JSON file whose caseId is WC-1001, WC-1002, WC-1003, or WC-1004. Facts are taken from the fixture document."]));
  }
  if (reset) {
    children.push(el("div", { class: "actions" }, [
      el("button", { class: "secondary", "data-action": "reset", disabled: busy, onclick: () => runAction(fixture.caseId, reset) }, [reset.label]),
    ]));
  }
  if (noticeText) children.push(el("div", { class: "notice", id: "notice" }, [noticeText]));
  if (errorText) children.push(el("div", { class: "error", id: "error", role: "alert" }, [errorText]));
  return el("section", { class: "panel", id: "action-panel" }, children);
}

function checkTable(checks) {
  return el("table", {}, [
    el("thead", {}, [el("tr", {}, ["Rule", "Actual", "Limit", "Result"].map((label) => el("th", {}, [label])))]),
    el("tbody", {}, checks.map((check) => el("tr", {}, [
      el("td", {}, [check.rule]),
      el("td", {}, [check.actual]),
      el("td", {}, [check.limit]),
      el("td", { class: check.result }, [check.result]),
    ]))),
  ]);
}

function makerEditor(caseDoc) {
  const original = caseDoc.modelMemo?.body
    ? `${caseDoc.modelMemo.headline}\n\n${caseDoc.modelMemo.body}`
    : (caseDoc.templateMemo || "");
  const label = caseDoc.modelMemo ? "Model draft" : "Reason-code template";
  return el("div", {}, [
    el("p", {}, [seat === "maker"
      ? "Maker seat. Edit the wording or accept it, then confirm. The outcome stays the policy outcome."
      : "Switch to the maker seat to edit and confirm."]),
    el("div", { class: "memo-grid" }, [
      el("div", {}, [el("h3", {}, [label]), el("pre", { class: "readonly", id: "model-memo" }, [original])]),
      el("div", {}, [
        el("h3", {}, ["Final memo"]),
        el("textarea", { id: "memo", oninput: onMemoInput }, [memoValue(caseDoc)]),
      ]),
    ]),
    caseDoc.caseId === "WC-1003"
      ? el("button", { class: "secondary", id: "insert-context", type: "button", onclick: insertContext }, ["Insert the late-invoice context sentence"])
      : null,
  ]);
}

function runAction(caseId, action) {
  if (action.id === "intake") return act(caseId, "intake", { source: action.source });
  if (action.id === "check-documents") return act(caseId, "check-documents", {});
  if (action.id === "start-policy") return act(caseId, "start-policy", {});
  if (action.id === "finalize") return act(caseId, "finalize", {});
  if (action.id === "open-maker") return act(caseId, "open-maker", {});
  if (action.id === "time-box") return act(caseId, "time-box", {});
  if (action.id === "select-build") return act(caseId, "select-build", { mode: action.mode });
  if (action.id === "maker-confirm") {
    const text = document.querySelector("#memo")?.value ?? memoValue(caseFor(caseId));
    return act(caseId, "maker", { seat: "maker", finalMemo: text });
  }
  if (action.id === "checker-confirm") return act(caseId, "checker", { seat: "checker" });
  if (action.id === "write-back") return act(caseId, "write-back", {});
  if (action.id === "reset") return act(caseId, "reset", {});
  return undefined;
}

function onDrop(event) {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const body = JSON.parse(String(reader.result));
      if (!PATHS.some((path) => path.id === body.caseId)) {
        errorText = "The file must name WC-1001, WC-1002, WC-1003, or WC-1004.";
        render();
        return;
      }
      choose(body.caseId);
      act(body.caseId, "intake", { source: "file-drop" });
    } catch {
      errorText = "The dropped file is not JSON.";
      render();
    }
  };
  reader.readAsText(file);
}

function strip(build, caseDoc) {
  const waiting = caseDoc?.status === "Checking policy" && caseDoc.policyOutcome === "Escalate" && !caseDoc.decisionPayload;
  const sha = build?.commit ? build.commit.slice(0, 7) : "unavailable";
  const link = build?.commit ? `${build.repository}/commit/${build.commit}` : build?.repository;
  return el("section", { class: "strip", id: "strip" }, [
    el("h2", {}, ["GitHub check-in"]),
    el("p", {}, [
      "Repository ",
      el("a", { href: build?.repository, target: "_blank", rel: "noreferrer" }, [build?.repository || ""]),
      ". Model ",
      el("strong", { id: "model-id" }, [build?.modelId || ""]),
      ".",
    ]),
    el("p", {}, [
      "Last green commit ",
      build?.commit
        ? el("a", { id: "green-commit", href: link, target: "_blank", rel: "noreferrer" }, [sha])
        : "not available",
      build?.onGitHub ? " · visible on GitHub." : " · not yet visible on GitHub from this process.",
      build?.dirty ? " Working tree has uncommitted edits." : "",
    ]),
    el("p", {}, [waiting
      ? "This case is waiting for a build. Select the landed commit, or use the last green build. The time box is four minutes and is not extended."
      : "No live attempt on this path. The last green commit is the exception service already checked in."]),
    build?.apiKeyPresent
      ? el("p", {}, ["The Grok call will be sent with the pinned model id."])
      : el("p", { id: "model-call" }, ["The Grok call is wired. No API key is set in this environment, so the service returns the fixture response that matches the contract. The model id on the payload is still grok-4.7."]),
    el("ul", { class: "checks" }, (build?.checks ?? []).map((check) => el("li", { class: check.pass ? "pass" : "fail" }, [`${check.pass ? "Pass" : "Fail"}: ${check.name}`]))),
    waiting
      ? el("div", { class: "actions", id: "strip-actions" }, (caseDoc.actions ?? [])
        .filter((action) => action.id === "select-build" || action.id === "time-box")
        .map((action) => el("button", {
          "data-action": action.id,
          "data-mode": action.mode || null,
          disabled: busy,
          class: action.id === "time-box" ? "secondary" : null,
          onclick: () => runAction(caseDoc.caseId, action),
        }, [action.label])))
      : null,
    caseDoc?.serviceBuildId
      ? el("p", {}, ["Service build on this case ", el("strong", { id: "service-build" }, [caseDoc.serviceBuildId.slice(0, 7)]), "."])
      : null,
  ]);
}

function definition(pairs) {
  return el("dl", {}, pairs.flatMap(([term, value]) => [el("dt", {}, [term]), el("dd", {}, [value ?? "—"])]));
}

function audit(caseDoc) {
  const regions = [];
  regions.push(el("section", { class: "region", id: "audit" }, [
    el("h2", {}, ["Audit record"]),
    caseDoc
      ? definition([
        ["Case", caseDoc.caseId],
        ["Applicant", caseDoc.legalName],
        ["Product", caseDoc.product],
        ["Amount", money(caseDoc.facilityAmount, caseDoc.currency)],
        ["Status", caseDoc.status],
        ["Policy version", caseDoc.policyVersion],
        ["Final decision", caseDoc.finalDecision],
        ["Finalized at", when(caseDoc.finalizedAt)],
      ])
      : el("p", {}, ["No audit lines yet. Receive the file to start a record for this path."]),
  ]));

  if (!caseDoc) return el("div", { class: "audit" }, regions);

  regions.push(el("section", { class: "region" }, [
    el("h2", {}, ["Documents"]),
    caseDoc.documents?.length ? documentTable(caseDoc.documents, `Completeness ${caseDoc.completeness || "—"}`) : el("p", {}, ["The document bot has not written the list."]),
    caseDoc.gapCodes?.length ? el("p", {}, [`Gap codes ${caseDoc.gapCodes.join(", ")}.`]) : null,
  ]));

  regions.push(el("section", { class: "region" }, [
    el("h2", {}, ["Policy"]),
    caseDoc.policyOutcome
      ? el("div", {}, [
        definition([
          ["Version", caseDoc.policyVersion],
          ["Outcome", caseDoc.policyOutcome],
          ["Reason codes", caseDoc.reasonCodes.join(", ")],
          ["Maker required", caseDoc.makerRequired],
          ["Checker required", caseDoc.checkerRequired],
        ]),
        checkTable(caseDoc.policyChecks),
      ])
      : el("p", {}, [caseDoc.completeness === "Gaps" ? "Policy did not run. The bureau snapshot is not on the case." : "Policy has not run."]),
  ]));

  regions.push(el("section", { class: "region", id: "advisory" }, [
    el("h2", {}, ["Advisory"]),
    definition([
      ["State", caseDoc.advisoryState],
      ["Repository", caseDoc.decisionPayload?.repository],
      ["Commit", caseDoc.serviceBuildId],
      ["Fallback used", caseDoc.decisionPayload?.fallbackUsed],
      ["Model", caseDoc.modelName || caseDoc.decisionPayload?.modelName],
      ["Conflict", caseDoc.advisoryConflict],
      ["Score", caseDoc.exceptionScore ? `${caseDoc.exceptionScore.score} ${caseDoc.exceptionScore.band}` : null],
    ]),
    caseDoc.modelInvocation?.reason ? el("p", { class: "note" }, [caseDoc.modelInvocation.reason]) : null,
    caseDoc.structuredComments?.length
      ? el("div", {}, caseDoc.structuredComments.map((comment) => el("article", { class: "event" }, [
        el("div", { class: "when" }, [`${comment.commentId} · ${comment.fromRole} · ${comment.topic} · ${comment.confidence}`]),
        el("p", {}, [comment.statement]),
        el("p", {}, [comment.conflictsWith ? `Conflicts with ${comment.conflictsWith}` : "Context only"]),
      ])))
      : null,
    caseDoc.modelMemo
      ? el("div", {}, [el("h3", {}, ["Model memo"]), el("pre", { class: "readonly" }, [`${caseDoc.modelMemo.headline}\n\n${caseDoc.modelMemo.body}`])])
      : el("p", {}, ["No model memo. A decline or a clean approve does not call the exception service."]),
    caseDoc.templateMemo
      ? el("div", {}, [el("h3", {}, ["Template memo"]), el("pre", { class: "readonly" }, [caseDoc.templateMemo])])
      : null,
    caseDoc.finalMemo
      ? el("div", {}, [el("h3", {}, ["Final memo"]), el("pre", { class: "readonly", id: "final-memo" }, [caseDoc.finalMemo])])
      : null,
  ]));

  regions.push(el("section", { class: "region" }, [
    el("h2", {}, ["People"]),
    definition([
      ["Maker", caseDoc.makerAction ? `${caseDoc.makerAction.result} · edited ${caseDoc.makerAction.edited ? "yes" : "no"} · ${when(caseDoc.makerAction.at)}` : (caseDoc.makerRequired === "No" ? "Not required" : "Waiting")],
      ["Checker", caseDoc.checkerAction ? `${caseDoc.checkerAction.result} · ${when(caseDoc.checkerAction.at)}` : (caseDoc.checkerRequired === "No" ? "Not required" : "Waiting")],
    ]),
  ]));

  regions.push(el("section", { class: "region", id: "los-panel" }, [
    el("h2", {}, ["Simulated LOS write-back"]),
    caseDoc.losReference
      ? definition([
        ["Reference", caseDoc.losReference],
        ["Outcome", caseDoc.finalDecision],
        ["Reason codes", caseDoc.reasonCodes.join(", ")],
        ["Policy version", caseDoc.policyVersion],
        ["Maker seat", caseDoc.makerAction ? "maker confirmed" : "not required"],
        ["Checker seat", caseDoc.checkerAction ? "checker confirmed" : "not required"],
        ["Service build", caseDoc.serviceBuildId],
        ["Written back at", when(caseDoc.writtenBackAt)],
        ["Label", "Simulated. No live loan origination system was contacted."],
      ])
      : el("p", {}, ["No simulated write-back yet."]),
  ]));

  regions.push(el("section", { class: "region", id: "events" }, [
    el("h2", {}, ["Events"]),
    el("ol", {}, caseDoc.auditLines.map((line) => el("li", { class: "event" }, [
      el("div", { class: "when" }, [`${when(line.time)} · ${line.actor}`]),
      el("strong", {}, [line.eventType]),
      el("div", {}, [`${line.statusBefore ?? "none"} → ${line.statusAfter ?? "none"}`]),
      el("p", {}, [line.detail]),
      line.policyVersion || line.serviceBuildId || line.modelName
        ? el("p", { class: "note" }, [
          [
            line.policyVersion ? `Policy ${line.policyVersion}` : null,
            line.serviceBuildId ? `Build ${line.serviceBuildId.slice(0, 7)}` : null,
            line.modelName ? `Model ${line.modelName}` : null,
          ].filter(Boolean).join(" · "),
        ])
        : null,
    ]))),
  ]));

  return el("div", { class: "audit" }, regions);
}

function render() {
  const fixture = fixtureFor(selected);
  const caseDoc = caseFor(selected);
  const policy = state.policy;
  app.replaceChildren(el("main", { class: "shell" }, [
    el("div", { class: "banner", id: "synthetic-banner" }, [policy?.syntheticMarker || "Synthetic demonstration record."]),
    el("header", { class: "top" }, [
      el("div", {}, [
        el("h1", {}, [policy?.product || "SME working-capital facility"]),
        el("p", { class: "policy-line" }, [
          `Policy ${policy?.version || ""} · ${policy?.currency || "USD"} · high value above ${policy ? money(policy.highValueAbove) : ""} · exposure cap ${policy ? money(policy.exposureCap) : ""} · DSCR ${policy?.dscrMinimum ?? ""} · scores ${policy?.scoreApprove ?? ""} / ${policy?.scoreDeclineBelow ?? ""} · SLA ${policy?.slaBusinessDays ?? ""} business days`,
        ]),
      ]),
      el("div", { class: "seats" }, [
        el("span", {}, ["Seat"]),
        el("button", { id: "seat-maker", "aria-pressed": seat === "maker" ? "true" : "false", onclick: () => { seat = "maker"; render(); } }, ["Maker"]),
        el("button", { id: "seat-checker", "aria-pressed": seat === "checker" ? "true" : "false", onclick: () => { seat = "checker"; render(); } }, ["Checker"]),
      ]),
    ]),
    el("div", { class: "switcher", id: "switcher" }, PATHS.map((path) => {
      const sample = fixtureFor(path.id);
      return el("button", {
        id: `path-${path.id}`,
        "aria-pressed": path.id === selected ? "true" : "false",
        onclick: () => choose(path.id),
      }, [
        el("strong", {}, [path.id]),
        el("span", {}, [path.title]),
        el("small", {}, [sample ? `${sample.legalName} · ${money(sample.facilityAmount)}` : path.room]),
        el("small", {}, [path.room]),
      ]);
    })),
    workflowBar(caseDoc?.workflow ?? [
      ["Received", "waiting"],
      ["Document check", "waiting"],
      ["Policy", "waiting"],
      ["Advisory", "waiting"],
      ["Maker", "waiting"],
      ["Checker", "waiting"],
      ["Written back", "waiting"],
    ].map(([label, stateName]) => ({ id: label, label, state: stateName, holder: null, result: null }))),
    strip(state.build, caseDoc),
    el("div", { class: "desk" }, [
      fixture ? actionPanel(fixture, caseDoc) : el("section", { class: "panel" }, [el("p", {}, ["Loading the fixtures."])]),
      samplePanel(fixture, caseDoc),
    ]),
    audit(caseDoc),
  ]));
}

window.addEventListener("hashchange", () => {
  const next = location.hash.slice(1);
  if (PATHS.some((path) => path.id === next)) choose(next);
});

load().then(render).catch((error) => {
  app.textContent = error.message;
});
