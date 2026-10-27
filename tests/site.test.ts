import assert from "node:assert/strict";
import { describe, it } from "vite-plus/test";
import { SITE_NAME, titleFor } from "../src/lib/site.ts";

describe("titleFor (titulo de la pestana)", () => {
  it("sin canal muestra el nombre del sitio", () => {
    assert.equal(titleFor(""), `${SITE_NAME} · Galería de canales de YouTube`);
    assert.equal(titleFor("   "), titleFor(""));
  });

  it("con canal pone el canal primero", () => {
    assert.equal(titleFor("@MrBeast"), `@MrBeast · ${SITE_NAME}`);
    assert.equal(titleFor("  @canal "), `@canal · ${SITE_NAME}`);
  });

  it("recorta URLs largas", () => {
    const t = titleFor("https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
    assert.ok(t.startsWith("https://www.youtube.com/channel/UCxxxxx"));
    assert.ok(t.includes("… · "));
    assert.ok(t.length <= 40 + 3 + SITE_NAME.length);
  });
});
