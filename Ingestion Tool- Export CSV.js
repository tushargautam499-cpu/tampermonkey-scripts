// ==UserScript==
// @name         Ingestion Tool -EXPORT CSV
// @namespace    http://tampermonkey.net/
// @version      4.1
// @description  Export unprocessed keywords via UI filters (EXPORT CSV) or selector modals (EXPORT ALL) with summary modal.
// @author       Tushar Gautam- @tuxgauta
// @match        https://content-risk-engine-iad.iad.proxy.amazon.com/keyword-management/unprocessed-keywords*
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";
  console.info("[CRE Export v3.4] loaded");

  /* ================= CONFIG ================= */

  const API_ENDPOINT = "/api/keyword-management/list-unprocessed-keywords";
  const PAGE_SIZE = 100;
  const DELAY_MS = 2000;

  const MP_STORAGE_KEY = "tm_cre_mps_v1";
  const PROC_STORAGE_KEY = "tm_cre_procs_v1";
  const KS_STORAGE_KEY = "tm_cre_keyword_sources_v1";
  const STATE_STORAGE_KEY = "tm_cre_keyword_states_v1";

  const MARKETPLACE_PRESETS = {
    EN: ["US","CA","UK","IN","AU","SG","AE","ZA"],
    DEFRITES: ["DE","FR","IT","ES","BE","MX"],
    IXP: ["BR", "EG","NL","PL","SE","TR","SA"],
    JP: ["JP"],
    ALL: ["US","CA","UK","IN","AU","SG","AE","ZA","DE","FR","IT","ES","BE","MX","BR", "EG","NL","PL","SE","TR","SA","JP","IE"]
  };

  const PROCESS_PRESETS = {
    SP: ["SPONSORED_PRODUCTS"],
    NON_SP: ["SPONSORED_BOOKS","HSA4V_PRODUCTS","HSA4S_PRODUCTS","STORES_MODERATION","SPONSORED_BRANDS_VIDEO","HSA4V_BOOKS","HSA4S_BOOKS","HSA4A_BOOKS"],
    ALL: ["SPONSORED_PRODUCTS","SPONSORED_BOOKS","HSA4V_PRODUCTS","HSA4S_PRODUCTS","STORES_MODERATION","SPONSORED_BRANDS_VIDEO","HSA4V_BOOKS","HSA4S_BOOKS","HSA4A_BOOKS"]
  };

  const KEYWORD_SOURCE_PRESETS = {
    DART: ["DART","ANDON"],
    DAV_1K: ["IMPRESSION_AUDITS"],
    PDS: ["PDS"],
    QUALITY_AUDITS: ["QUALITY_AUDITS"],
    ALL: ["DART","ANDON","IMPRESSION_AUDITS","PDS","QUALITY_AUDITS","AD_FEEDBACK","EXP_TEAM","NEW_POLICY","COVERAGE_EXTENSION","POLICY_UPDATE","WATCH_WORD","CEP"]
  };

  const KEYWORD_STATE_PRESETS = {
    DEPLOYED: ["RULE_DEPLOYED"],
    DROPPED: ["KEYWORD_DROPPED"],
    INGESTED: ["KEYWORD_INGESTED"],
    WIP: ["KEYWORD_ASSIGNED","RULE_CREATED","EXPERIMENT_COMPLETED","EXPERIMENT_IN_PROGRESS"],
    ALL: ["RULE_DEPLOYED","KEYWORD_DROPPED","KEYWORD_INGESTED","KEYWORD_ASSIGNED","RULE_CREATED","EXPERIMENT_COMPLETED","EXPERIMENT_IN_PROGRESS"]
  };

  const ALL_MARKETPLACES = [...new Set(Object.values(MARKETPLACE_PRESETS).flat())];
  const ALL_PROCESSES = PROCESS_PRESETS.ALL;
  const ALL_KEYWORD_SOURCES = KEYWORD_SOURCE_PRESETS.ALL;
  const ALL_KEYWORD_STATES = KEYWORD_STATE_PRESETS.ALL

  /* ================= HELPERS ================= */

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const safe = (v) => v == null ? "" : String(v);

  function utc(ms) {
    if (!ms) return "";
    const d = new Date(Number(ms));
    const p = n => String(n).padStart(2,"0");
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
  }

  /* ================= UI DROPDOWN READER ================= */

  function readReactSelect(id) {
    const el = document.getElementById(id);
    if (!el) return [];
    const chips = [...el.querySelectorAll(".css-1rhbuit-multiValue")];
    if (chips.length) return chips.map(c => c.innerText.trim());
    const single = el.querySelector(".css-1uccc91-singleValue");
    if (single) return [single.innerText.trim()];
    return [];
  }

  /* ================= STATE LINK ================= */

  function extractStateLink(item) {
    try {
      if (!item?.stateConfigMap) return "";
      if (item.stateConfigMap.EXPERIMENT_DETAILS) {
        const e = String(item.stateConfigMap.EXPERIMENT_DETAILS);
        if (e.includes("/")) return `${location.origin}/experiments/view/${e}`;
      }
      if (item.stateConfigMap.RULE_IDS) {
        return String(item.stateConfigMap.RULE_IDS)
          .split(/[,\s]+/)
          .filter(x => /^\d+$/.test(x))
          .map(id => `${location.origin}/rule-management/update-rule?ruleId=${id}`)
          .join(", ");
      }
    } catch {}
    return "";
  }

  /* ================= DROP REASON ================= */

  function extractDropReason(item) {
    const keys = ["dropReason","dropReasonText","dropReasonMessage","dropReasonDetail","drop_reason","drop_reason_text","reason","dropExplanation"];
    for (const k of keys) if (item?.[k]) return safe(item[k]);
    if (item?.drop?.reason) return safe(item.drop.reason);
    if (item?.drop?.message) return safe(item.drop.message);
    if (item?.stateConfigMap?.DROP_REASON) return safe(item.stateConfigMap.DROP_REASON);
    return "";
  }

  /* ================= CSV ================= */

  function mapRow(item) {
    return [
      item.process || item.adProgram || "",
      item.marketplace || "",
      item.keywordDetails?.keywordName || item.keywordName || "",
      item.label || item.policy || "",
      item.keywordSource || "",
      item.keywordDetails?.attributeFlagged || "",
      item.ingestedUserName || "",
      item.referenceSim || "",
      utc(item.creationTime),
      item.state || "",
      item.assignedTo || "",
      extractStateLink(item),
      extractDropReason(item)
    ];
  }

  function downloadCSV(rows) {
    const header = [
      "AD PROGRAM","MARKETPLACE","KEYWORD","POLICY","KEYWORD SOURCE",
      "ATTRIBUTE FLAGGED","INGESTED BY","REFERENCE SIM",
      "INGESTION DATE UTC","STATE","ASSIGNED USER",
      "STATE LINK","DROP REASON"
    ];
    const lines = [header.join(",")];
    rows.forEach(r =>
      lines.push(r.map(v => /[",\n]/.test(v) ? `"${v.replace(/"/g,'""')}"` : v).join(","))
    );
    GM_download({
      url: "data:text/csv;charset=utf-8," + encodeURIComponent(lines.join("\r\n")),
      name: `cre-unprocessed-${new Date().toISOString().replace(/:/g,"-")}.csv`,
      saveAs: false
    });
  }

  /* ================= FETCH ================= */

  async function fetchAll(template, controller, summary) {
    const all = [];
    let start = 0;

    while (true) {
      if (controller.isCancelled()) break;
      template.pagination.startIndex = start;

      const resp = await new Promise((res,rej)=>
        GM_xmlhttpRequest({
          method:"POST",
          url: location.origin + API_ENDPOINT,
          headers:{ "Content-Type":"application/json" },
          data: JSON.stringify(template),
          onload: res,
          onerror: rej
        })
      );

      const json = JSON.parse(resp.responseText || "{}");
      const items = json.keywordRecords || json.items || [];
      all.push(...items);

      summary.pages++;
      controller.update({ rows: all.length, pages: summary.pages, lastCount: items.length });

      if (items.length < PAGE_SIZE) break;
      start += PAGE_SIZE;
      await sleep(DELAY_MS);
    }
    return all;
  }

  /* ================= PROGRESS + SUMMARY MODAL ================= */

  function createProgressModal() {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99999;display:flex;align-items:center;justify-content:center";

    const panel = document.createElement("div");
    panel.style.cssText = "background:#fff;padding:16px;border-radius:8px;width:520px;font-family:Arial";

    panel.innerHTML = `
      <b>Exporting CSV — Progress</b>
      <div id="stat" style="margin:8px 0">Starting…</div>
      <div style="height:12px;background:#eee;border-radius:6px">
        <div id="bar" style="height:100%;width:0;background:#4caf50"></div>
      </div>
      <div style="text-align:right;margin-top:10px">
        <button id="cancel" style="background:#f44336;color:#fff">Cancel</button>
      </div>
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    let cancelled = false;
    panel.querySelector("#cancel").onclick = () => cancelled = true;

    function showSummary(summary) {
      const dur = Math.round((Date.now() - summary.startedAt) / 1000);
      const fmt = o => Object.entries(o).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k} : ${v}`).join("\n");

      panel.innerHTML = `
        <div style="font-size:18px;font-weight:700;">✔ Export completed</div>
        <div style="font-size:13px;margin:8px 0;">
          <b>Total:</b> ${summary.total}<br>
          <b>Pages:</b> ${summary.pages}<br>
          <b>Duration:</b> ${dur}s
        </div>
        <pre style="font-size:12px;background:#f7f7f7;padding:10px;border-radius:6px;max-height:320px;overflow:auto;">
Marketplaces
${fmt(summary.marketplaces)}

Processes
${fmt(summary.processes)}

Keyword Sources
${fmt(summary.keywordSources)}

Keyword States
${fmt(summary.states)}
        </pre>
        <div style="text-align:right;margin-top:10px;">
          <button id="close">Close</button>
        </div>
      `;
      panel.querySelector("#close").onclick = () => overlay.remove();
    }

    return {
      update: ({rows=0,pages=0,lastCount=0})=>{
        panel.querySelector("#stat").innerText = `Rows: ${rows} | Pages: ${pages} | Last: ${lastCount}`;
        panel.querySelector("#bar").style.width = Math.min(100, Math.log10(1+rows)*12) + "%";
      },
      isCancelled: ()=>cancelled,
      showSummary
    };
  }

 /* ================= GENERIC SELECTOR (ENHANCED v2) ================= */

function selectorModal(title, step, totalSteps, items, presets, storageKey, onDone, onBack) {
  const saved = JSON.parse(localStorage.getItem(storageKey)||"[]");
  const sel = new Set(saved.length ? saved : presets[Object.keys(presets)[0]]);

  const o = document.createElement("div");
  o.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100000;display:flex;align-items:center;justify-content:center";

  o.innerHTML = `
    <div style="background:#fff;padding:16px 20px;border-radius:8px;width:520px;max-height:80vh;overflow:auto;position:relative">
      <span id="close" style="position:absolute;top:8px;right:10px;cursor:pointer;font-size:18px;font-weight:bold">✕</span>

      <div style="font-size:12px;color:#666;margin-bottom:4px">
        Step ${step} of ${totalSteps}
      </div>

      <b style="font-size:16px">${title}</b>

      <div style="display:flex;flex-wrap:wrap;gap:6px;margin:10px 0">
        ${Object.keys(presets).map(p=>`<button data-p="${p}">${p}</button>`).join("")}
        <button id="clear" style="margin-left:auto;background:#eee">CLEAR</button>
      </div>

      <div id="list" style="column-count:2;column-gap:16px;font-size:13px"></div>

      <div style="display:flex;justify-content:space-between;margin-top:14px">
        <button id="back">Back</button>
        <button id="ok" style="background:#ff9900;font-weight:700">Next</button>
      </div>
    </div>
  `;

  document.body.appendChild(o);

  const list = o.querySelector("#list");

  function render() {
    list.innerHTML = items.map(i=>`
      <label style="break-inside:avoid">
        <input type="checkbox" ${sel.has(i)?"checked":""} data-i="${i}"> ${i}
      </label>
    `).join("<br>");
  }
  render();

  /* Presets */
  o.querySelectorAll("button[data-p]").forEach(b=>b.onclick=()=>{
    sel.clear();
    (presets[b.dataset.p] || []).forEach(x=>sel.add(x));
    render();
  });

  /* CLEAR */
  o.querySelector("#clear").onclick = () => {
    sel.clear();
    render();
  };

  /* NEXT */
  o.querySelector("#ok").onclick = () => {
    const out = [...list.querySelectorAll("input:checked")].map(i=>i.dataset.i);
    localStorage.setItem(storageKey, JSON.stringify(out));
    cleanup();
    onDone(out);
  };

  /* BACK */
  o.querySelector("#back").onclick = () => {
    cleanup();
    if (onBack) onBack();
  };

  /* CLOSE (✕) */
  o.querySelector("#close").onclick = cleanup;

  /* ESC key */
  function onKey(e) {
    if (e.key === "Escape") cleanup();
  }
  document.addEventListener("keydown", onKey);

  function cleanup() {
    document.removeEventListener("keydown", onKey);
    o.remove();
  }
}

  /* ================= BUTTONS ================= */

  function attach() {
    if (document.getElementById("tm_export_all")) return;
    const listBtn=[...document.querySelectorAll("button")].find(b=>b.innerText==="LIST KEYWORDS");
    if (!listBtn) return;

    /* EXPORT CSV (UI filters) */
    const exportCsvBtn = document.createElement("button");
    exportCsvBtn.innerText = "⬇ EXPORT CSV";
    exportCsvBtn.style.marginLeft="6px";
    exportCsvBtn.style.background="#ffea3b";
    exportCsvBtn.style.fontWeight="700";
    listBtn.parentNode.appendChild(exportCsvBtn);

    exportCsvBtn.onclick = async () => {
      const template = {
        author:"",
        keywordSearchCriteria:{
          processes: readReactSelect("ap-dropdown").map(x=>x.toUpperCase()),
          marketplaces: readReactSelect("mp-dropdown").map(x=>x.toUpperCase()),
          keywordSources: readReactSelect("kwsource-dropdown").map(x=>x.toUpperCase()),
          states: readReactSelect("kwstate-dropdown").map(x=>x.toUpperCase()),
          labels: readReactSelect("policy-dropdown").map(x=>x.toUpperCase()),
          assignedTos:[]
        },
        pagination:{ size:PAGE_SIZE, startIndex:0 }
      };

      const summary = { startedAt:Date.now(), pages:0, total:0, marketplaces:{}, processes:{}, keywordSources:{}, states:{} };
      const modal = createProgressModal();
      const items = await fetchAll(template, modal, summary);

      const rows = items.map(item=>{
        summary.total++;
        summary.marketplaces[item.marketplace||"UNKNOWN"]=(summary.marketplaces[item.marketplace||"UNKNOWN"]||0)+1;
        summary.processes[item.process||item.adProgram||"UNKNOWN"]=(summary.processes[item.process||item.adProgram||"UNKNOWN"]||0)+1;
        summary.keywordSources[item.keywordSource||"UNKNOWN"]=(summary.keywordSources[item.keywordSource||"UNKNOWN"]||0)+1;
        summary.states[item.state||"UNKNOWN"]=(summary.states[item.state||"UNKNOWN"]||0)+1;
        return mapRow(item);
      });

      downloadCSV(rows);
      modal.showSummary(summary);
    };

    /* EXPORT ALL (selectors) */
    const btn=document.createElement("button");
    btn.id="tm_export_all";
    btn.innerText= "🚀 EXPORT ALL";
    btn.style.marginLeft="6px";
    btn.style.background="#ff9900";
    btn.style.fontWeight="700";
    listBtn.parentNode.appendChild(btn);

    btn.onclick = function start() {

  function step1() {
    selectorModal(
      "Select Marketplaces", 1, 4,
      ALL_MARKETPLACES, MARKETPLACE_PRESETS, MP_STORAGE_KEY,
      step2,
      null
    );
  }

  function step2(mps) {
    selectorModal(
      "Select Ad Programs", 2, 4,
      ALL_PROCESSES, PROCESS_PRESETS, PROC_STORAGE_KEY,
      step3,
      step1
    );
  }

  function step3(procs) {
    selectorModal(
      "Select Keyword Sources", 3, 4,
      ALL_KEYWORD_SOURCES, KEYWORD_SOURCE_PRESETS, KS_STORAGE_KEY,
      step4,
      step2
    );
  }

  async function step4(sources) {
    selectorModal(
      "Select Keyword States", 4, 4,
      ALL_KEYWORD_STATES, KEYWORD_STATE_PRESETS, STATE_STORAGE_KEY,
      async (states) => {

        const mps = JSON.parse(localStorage.getItem(MP_STORAGE_KEY) || "[]");
        const procs = JSON.parse(localStorage.getItem(PROC_STORAGE_KEY) || "[]");

        const summary = { startedAt:Date.now(), pages:0, total:0, marketplaces:{}, processes:{}, keywordSources:{}, states:{} };

        const template = {
          author:"",
          keywordSearchCriteria:{
            marketplaces:mps,
            processes:procs,
            keywordSources:sources.length?sources:[],
            states:states.length?states:[],
            assignedTos:[],
            labels:[]
          },
          pagination:{ size:PAGE_SIZE, startIndex:0 }
        };

        const modal = createProgressModal();
        const items = await fetchAll(template, modal, summary);

        const rows = items.map(item=>{
          summary.total++;
          summary.marketplaces[item.marketplace||"UNKNOWN"]=(summary.marketplaces[item.marketplace||"UNKNOWN"]||0)+1;
          summary.processes[item.process||item.adProgram||"UNKNOWN"]=(summary.processes[item.process||item.adProgram||"UNKNOWN"]||0)+1;
          summary.keywordSources[item.keywordSource||"UNKNOWN"]=(summary.keywordSources[item.keywordSource||"UNKNOWN"]||0)+1;
          summary.states[item.state||"UNKNOWN"]=(summary.states[item.state||"UNKNOWN"]||0)+1;
          return mapRow(item);
        });

        downloadCSV(rows);
        modal.showSummary(summary);

      },
      step3
    );
  }

  step1();
};
  }

  new MutationObserver(attach).observe(document.body,{childList:true,subtree:true});
  setTimeout(attach,800);
})();
