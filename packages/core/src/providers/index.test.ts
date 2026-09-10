import { test } from "node:test";
import assert from "node:assert/strict";
import { createProvider } from "./index.js";

test("bedrock without AWS_REGION or AWS_DEFAULT_REGION throws a clear error", () => {
  const prevRegion = process.env.AWS_REGION;
  const prevDefault = process.env.AWS_DEFAULT_REGION;
  delete process.env.AWS_REGION;
  delete process.env.AWS_DEFAULT_REGION;
  try {
    assert.throws(() => createProvider("bedrock"), /AI_PROVIDER=bedrock requires AWS_REGION/);
  } finally {
    if (prevRegion !== undefined) process.env.AWS_REGION = prevRegion;
    if (prevDefault !== undefined) process.env.AWS_DEFAULT_REGION = prevDefault;
  }
});

test("bedrock with AWS_REGION constructs a provider with id 'bedrock' and anthropic.-prefixed models", () => {
  const prev = process.env.AWS_REGION;
  process.env.AWS_REGION = "us-east-1";
  try {
    const p = createProvider("bedrock");
    assert.equal(p.id, "bedrock");
    assert.match(p.liveModel, /^anthropic\./);
    assert.match(p.batchModel, /^anthropic\./);
  } finally {
    if (prev !== undefined) process.env.AWS_REGION = prev;
    else delete process.env.AWS_REGION;
  }
});

test("AWS_DEFAULT_REGION is accepted when AWS_REGION is unset", () => {
  const prevRegion = process.env.AWS_REGION;
  delete process.env.AWS_REGION;
  process.env.AWS_DEFAULT_REGION = "eu-west-1";
  try {
    const p = createProvider("bedrock");
    assert.equal(p.id, "bedrock");
  } finally {
    delete process.env.AWS_DEFAULT_REGION;
    if (prevRegion !== undefined) process.env.AWS_REGION = prevRegion;
  }
});

test("an unknown AI_PROVIDER value throws rather than silently defaulting", () => {
  const prev = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = "openai";
  try {
    assert.throws(() => createProvider(), /AI_PROVIDER="openai" is not implemented/);
  } finally {
    if (prev !== undefined) process.env.AI_PROVIDER = prev;
    else delete process.env.AI_PROVIDER;
  }
});
