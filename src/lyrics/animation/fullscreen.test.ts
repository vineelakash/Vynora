import assert from "node:assert/strict";
import test from "node:test";
import { getResponsiveFontSize, getBaseFontSize } from "./styles/styleHelpers.ts";

test("fullscreen: responsive font scaling adapts gracefully across resolutions", () => {
  // Embedded preview baseline (e.g. 640x360)
  const previewSize = getResponsiveFontSize('medium', 640, 360);
  assert.equal(previewSize, getBaseFontSize('medium'));
  assert.equal(previewSize, 34);

  // 720p Fullscreen (1280x720)
  const size720p = getResponsiveFontSize('medium', 1280, 720);
  assert.ok(size720p >= 38 && size720p <= 44, `720p size ${size720p} should scale proportionally`);

  // 1080p Fullscreen (1920x1080)
  const size1080p = getResponsiveFontSize('medium', 1920, 1080);
  assert.ok(size1080p >= 50 && size1080p <= 65, `1080p size ${size1080p} should be larger than 720p`);
  assert.ok(size1080p > size720p, "1080p font size should exceed 720p font size");

  // 1440p Fullscreen (2560x1440)
  const size1440p = getResponsiveFontSize('medium', 2560, 1440);
  assert.ok(size1440p > size1080p, "1440p font size should exceed 1080p font size");

  // 4K Fullscreen (3840x2160) - clamped to max scale factor 2.2
  const size4k = getResponsiveFontSize('medium', 3840, 2160);
  assert.ok(size4k <= Math.round(44 * 2.2), "4K font size must respect upper clamp ceiling");
  assert.ok(size4k >= size1440p, "4K font size should be >= 1440p");

  // Ultrawide 21:9 (3440x1440)
  const sizeUltrawide = getResponsiveFontSize('medium', 3440, 1440);
  // Uses min(width/1280, height/800), so height 1440 governs aspect scaling
  assert.equal(sizeUltrawide, size1440p, "Ultrawide height constraint should match 1440p vertical scale");
});

test("fullscreen: font size choices maintain relative visual hierarchy", () => {
  const width = 1920;
  const height = 1080;

  const small = getResponsiveFontSize('small', width, height);
  const medium = getResponsiveFontSize('medium', width, height);
  const large = getResponsiveFontSize('large', width, height);
  const xl = getResponsiveFontSize('xl', width, height);

  assert.ok(small < medium, `Small (${small}) must be < Medium (${medium})`);
  assert.ok(medium < large, `Medium (${medium}) must be < Large (${large})`);
  assert.ok(large < xl, `Large (${large}) must be < XL (${xl})`);
});
