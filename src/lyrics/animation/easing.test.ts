import assert from "node:assert/strict";
import test from "node:test";
import {
  clamp,
  lerp,
  easeOutQuad,
  easeOutCubic,
  easeInOutQuad,
  springSettling,
  smoothDamp,
} from "./easing.ts";

test("easing: clamp restricts values to [min, max]", () => {
  assert.equal(clamp(0.5, 0, 1), 0.5);
  assert.equal(clamp(-0.2, 0, 1), 0);
  assert.equal(clamp(1.5, 0, 1), 1);
  assert.equal(clamp(50, 10, 20), 20);
});

test("easing: lerp smoothly blends between numbers", () => {
  assert.equal(lerp(10, 20, 0), 10);
  assert.equal(lerp(10, 20, 1), 20);
  assert.equal(lerp(10, 20, 0.5), 15);
});

test("easing: easeOutQuad and easeOutCubic curve properties", () => {
  assert.equal(easeOutQuad(0), 0);
  assert.equal(easeOutQuad(1), 1);
  assert.ok(easeOutQuad(0.5) > 0.5); // Concave down deceleration

  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.ok(easeOutCubic(0.5) > 0.5);
});

test("easing: easeInOutQuad smooth S-curve", () => {
  assert.equal(easeInOutQuad(0), 0);
  assert.equal(easeInOutQuad(1), 1);
  assert.equal(easeInOutQuad(0.5), 0.5);
});

test("easing: springSettling settles smoothly towards target", () => {
  const atZero = springSettling(0);
  assert.equal(atZero, 0);

  const atEnd = springSettling(1);
  assert.ok(Math.abs(atEnd - 1) < 0.05); // Settles near 1
});

test("easing: smoothDamp produces controlled velocity damping", () => {
  const vel = { value: 0 };
  const nextPos = smoothDamp(0, 100, vel, 0.2, 0.016);
  assert.ok(nextPos > 0);
  assert.ok(vel.value > 0);
  assert.ok(nextPos < 100);
});
