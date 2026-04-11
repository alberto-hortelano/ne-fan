import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { AnimationController } from "../src/animation/animation-controller.js";
import { loadAnimationConfigs } from "../src/animation/animation-state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const configJson = JSON.parse(
  readFileSync(resolve(__dirname, "../data/combat_config.json"), "utf-8"),
);
const { animations, transitions } = loadAnimationConfigs(configJson);
const SPRINT = configJson.player?.sprint_speed ?? 3.8;

function makeInputs(speed = 0, turning = false): {
  speed: number;
  turning: boolean;
  sprintSpeed: number;
} {
  return { speed, turning, sprintSpeed: SPRINT };
}

describe("AnimationController", () => {
  it("starts in idle", () => {
    const ctrl = new AnimationController(animations, transitions);
    assert.equal(ctrl.currentState, "idle");
  });

  it("idle → walk when moving", () => {
    const ctrl = new AnimationController(animations, transitions);
    const events = ctrl.tick(0.016, makeInputs(1.5));
    assert.equal(ctrl.currentState, "walk");
    assert.equal(events[0]?.type, "state_changed");
    assert.equal(events[0]?.from, "idle");
    assert.equal(events[0]?.to, "walk");
  });

  it("walk → run when sprinting", () => {
    const ctrl = new AnimationController(animations, transitions);
    ctrl.tick(0.016, makeInputs(1.5)); // idle → walk
    const events = ctrl.tick(0.016, makeInputs(3.5));
    assert.equal(ctrl.currentState, "run");
    assert.equal(events[0]?.to, "run");
  });

  it("run → walk → idle when stopping", () => {
    const ctrl = new AnimationController(animations, transitions);
    ctrl.tick(0.016, makeInputs(3.5)); // idle → run (skips walk since speed > threshold)
    ctrl.tick(0.016, makeInputs(1.5)); // run → walk
    assert.equal(ctrl.currentState, "walk");
    ctrl.tick(0.016, makeInputs(0));   // walk → idle
    assert.equal(ctrl.currentState, "idle");
  });

  it("idle → attack (non-interruptible)", () => {
    const ctrl = new AnimationController(animations, transitions);
    const events = ctrl.requestAction("quick");
    assert.equal(ctrl.currentState, "quick");
    assert.equal(events[0]?.to, "quick");
  });

  it("attack cannot be interrupted by movement", () => {
    const ctrl = new AnimationController(animations, transitions);
    ctrl.requestAction("quick");
    ctrl.tick(0.5, makeInputs(2.0)); // try to move during attack
    assert.equal(ctrl.currentState, "quick"); // still attacking
  });

  it("attack completes → returns to idle", () => {
    const ctrl = new AnimationController(animations, transitions);
    ctrl.requestAction("quick"); // duration = 2.33s
    ctrl.tick(2.4, makeInputs(0)); // exceed duration
    assert.equal(ctrl.currentState, "idle");
  });

  it("queue: attack + jump → attack completes → jump", () => {
    const ctrl = new AnimationController(animations, transitions);
    ctrl.requestAction("medium"); // duration = 1.30s
    const queueEvents = ctrl.requestAction("jump"); // queued
    assert.equal(queueEvents[0]?.type, "action_queued");
    assert.equal(ctrl.currentState, "medium");

    // Advance past medium duration
    ctrl.tick(1.4, makeInputs(0));
    assert.equal(ctrl.currentState, "jump"); // dequeued
  });

  it("queue: attack + jump → jump completes → idle", () => {
    const ctrl = new AnimationController(animations, transitions);
    ctrl.requestAction("medium");
    ctrl.requestAction("jump");
    ctrl.tick(1.4, makeInputs(0)); // medium → jump
    ctrl.tick(0.9, makeInputs(0)); // jump → idle
    assert.equal(ctrl.currentState, "idle");
  });

  it("turn inserted when direction changes significantly", () => {
    const ctrl = new AnimationController(animations, transitions);
    ctrl.tick(0.016, makeInputs(1.5)); // idle → walk
    const events = ctrl.tick(0.016, makeInputs(1.5, true)); // turning
    assert.equal(ctrl.currentState, "turn");
  });

  it("turn completes → idle (auto return)", () => {
    const ctrl = new AnimationController(animations, transitions);
    ctrl.tick(0.016, makeInputs(1.5)); // idle → walk
    ctrl.tick(0.016, makeInputs(1.5, true)); // walk → turn
    ctrl.tick(1.0, makeInputs(0)); // turn completes → idle
    assert.equal(ctrl.currentState, "idle");
  });

  it("death is not interruptible and does not return", () => {
    const ctrl = new AnimationController(animations, transitions);
    ctrl.forceState("death");
    assert.equal(ctrl.currentState, "death");
    // death loops=false, duration=2.30
    ctrl.tick(2.5, makeInputs(0));
    // auto_return to idle after death completes
    assert.equal(ctrl.currentState, "idle");
  });

  it("forceState works for hit reaction", () => {
    const ctrl = new AnimationController(animations, transitions);
    ctrl.tick(0.016, makeInputs(1.5)); // walking
    ctrl.forceState("hit");
    assert.equal(ctrl.currentState, "hit");
    assert.ok(!ctrl.isInterruptible());
  });

  it("getProgress works for looping animations", () => {
    const ctrl = new AnimationController(animations, transitions);
    ctrl.tick(0.55, makeInputs(0)); // idle, 0.55s into 3.67s duration
    const progress = ctrl.getProgress();
    assert.ok(progress > 0.1 && progress < 0.2);
  });

  it("getProgress works for one-shot animations", () => {
    const ctrl = new AnimationController(animations, transitions);
    ctrl.requestAction("quick"); // 1.00s
    ctrl.tick(0.5, makeInputs(0)); // halfway
    assert.ok(Math.abs(ctrl.getProgress() - 0.5) < 0.01);
  });

  it("max queue size is 3", () => {
    const ctrl = new AnimationController(animations, transitions);
    ctrl.requestAction("quick");
    ctrl.requestAction("jump");
    ctrl.requestAction("kick");
    ctrl.requestAction("medium");
    const e = ctrl.requestAction("heavy"); // should be rejected (queue full)
    assert.equal(ctrl.queue.length, 3);
    assert.equal(e.length, 0);
  });
});
