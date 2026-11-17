import {test} from "node:test";
import assert from "node:assert/strict";
import {contactTransferFiles,inspectContactRows,parseContactCsv} from "../packages/contacts/src/index.ts";
import {parseEnvelopeQuery} from "../packages/http/src/index.ts";
import {signingDecisionFits} from "../packages/signing/src/decision.ts";

test("contact transfer splits large exports and preserves previously escaped values",()=>{
  const rows=Array.from({length:201},(_,i)=>({name:"- Contact "+i,email:"+team"+i+"@example.invalid",company:"'Original company"}));
  const parts=contactTransferFiles(rows);
  assert.equal(parts.length,2);
  const extracted=parts.flatMap(part=>inspectContactRows(parseContactCsv(part),{name:0,email:1,company:2}));
  assert.deepEqual(extracted.map(row=>row.contact),rows);
  assert.ok(extracted.every(row=>!row.errors.length));
  assert.ok(parts[0].includes("\"'+team0@example.invalid\""));
});

test("finalizing is a valid API filter and decision caps are based on UTF-8 bytes",()=>{
  assert.equal(parseEnvelopeQuery(new URLSearchParams("status=finalizing")).status,"finalizing");
  assert.ok(signingDecisionFits({answer:"Å".repeat(2000)}));
  assert.ok(!signingDecisionFits({answer:"李".repeat(4000)}));
});
