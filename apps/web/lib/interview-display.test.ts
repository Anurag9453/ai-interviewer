import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeInterview, documentDisplayName, formatMinutes, humanizeCategoryId,
  isTerminal, scoreBand, statusLabel,
} from "./interview-display.js";

test("a resume interview is labelled as one, with the file as its detail", () => {
  const d = describeInterview({
    categoryId: "custom_ab12cd34",
    categoryLabel: null,
    documentType: "resume",
    documentFilename: "anurag-resume.pdf",
  });
  assert.equal(d.kind, "resume");
  assert.equal(d.title, "Resume interview");
  assert.equal(d.detail, "anurag-resume");
});

test("a material interview is titled by its document, not by its synthetic category", () => {
  // The synthetic category is active=false and therefore invisible to RLS, so
  // falling back to it would render an opaque `custom_...` id to the user.
  const d = describeInterview({
    categoryId: "custom_ab12cd34",
    categoryLabel: null,
    documentType: "material",
    documentFilename: "distributed-systems-notes.pdf",
  });
  assert.equal(d.kind, "material");
  assert.equal(d.title, "distributed-systems-notes");
  assert.equal(d.detail, "Your own material");
});

test("a standard interview uses the readable category label", () => {
  const d = describeInterview({ categoryId: "salesforce_dev", categoryLabel: "Salesforce Developer" });
  assert.equal(d.kind, "standard");
  assert.equal(d.title, "Salesforce Developer");
  assert.equal(d.detail, undefined);
});

test("a standard interview with no readable label humanizes the id rather than showing a slug", () => {
  const d = describeInterview({ categoryId: "salesforce_dev", categoryLabel: null });
  assert.equal(d.title, "Salesforce Dev");
});

test("an empty or whitespace category label does not win over the humanized id", () => {
  assert.equal(describeInterview({ categoryId: "data_eng", categoryLabel: "   " }).title, "Data Eng");
  assert.equal(describeInterview({ categoryId: "data_eng", categoryLabel: "" }).title, "Data Eng");
});

test("a resume interview with no filename omits the detail line rather than showing an empty one", () => {
  const d = describeInterview({ categoryId: "custom_x", documentType: "resume", documentFilename: null });
  assert.equal(d.title, "Resume interview");
  assert.equal("detail" in d, false);
});

test("documentDisplayName strips only known extensions and never returns empty", () => {
  assert.equal(documentDisplayName("cv.pdf"), "cv");
  assert.equal(documentDisplayName("notes.DOCX"), "notes");
  assert.equal(documentDisplayName("spec.txt"), "spec");
  assert.equal(documentDisplayName("resume.v2.pdf"), "resume.v2");
  assert.equal(documentDisplayName("archive.tar.gz"), "archive.tar.gz");
  assert.equal(documentDisplayName(".pdf"), ".pdf", "a name that is only an extension must not become empty");
});

test("humanizeCategoryId drops the custom_ prefix and title-cases the rest", () => {
  assert.equal(humanizeCategoryId("custom_ab12cd34"), "Ab12cd34");
  assert.equal(humanizeCategoryId("backend-engineering"), "Backend Engineering");
});

test("statusLabel hides internal states and distinguishes how an interview ended", () => {
  assert.equal(statusLabel("complete", "completed"), "Completed");
  assert.equal(statusLabel("complete", "user_ended"), "Ended early");
  assert.equal(statusLabel("abandoned", "disconnected"), "Disconnected");
  assert.equal(statusLabel("abandoned", null), "Not finished");
  assert.equal(statusLabel("live"), "In progress");
  assert.equal(statusLabel("grading"), "Scoring");
  assert.equal(statusLabel("configuring"), "Not started");
  // Never leak a raw internal token to the candidate.
  assert.equal(statusLabel("some_future_state"), "Unknown");
});

test("isTerminal marks exactly the states that can have a report", () => {
  assert.equal(isTerminal("complete"), true);
  assert.equal(isTerminal("abandoned"), true);
  assert.equal(isTerminal("live"), false);
  assert.equal(isTerminal("grading"), false);
  assert.equal(isTerminal("configuring"), false);
});

test("scoreBand boundaries are inclusive at the band edges", () => {
  assert.equal(scoreBand(100), "strong");
  assert.equal(scoreBand(70), "strong");
  assert.equal(scoreBand(69), "mixed");
  assert.equal(scoreBand(45), "mixed");
  assert.equal(scoreBand(44), "weak");
  assert.equal(scoreBand(0), "weak");
});

test("formatMinutes rounds to whole minutes", () => {
  assert.equal(formatMinutes(900), "15 min");
  assert.equal(formatMinutes(600), "10 min");
  assert.equal(formatMinutes(1830), "31 min");
});
