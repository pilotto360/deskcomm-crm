import { describe, expect, it } from "vitest";

import { escolherAcaoDeConversao } from "./conversao-de-doacao";

describe("escolha da ação de conversão do Google Ads (avulsa x recorrente)", () => {
  it("doação avulsa sempre usa a ação avulsa", () => {
    expect(escolherAcaoDeConversao("avulsa", { avulsa: "111", recorrente: "222" })).toBe("111");
    expect(escolherAcaoDeConversao("avulsa", { avulsa: "111", recorrente: null })).toBe("111");
  });

  it("recorrente usa a ação recorrente quando cadastrada", () => {
    expect(escolherAcaoDeConversao("recorrente", { avulsa: "111", recorrente: "222" })).toBe("222");
  });

  it("recorrente cai para a ação avulsa quando a organização não distingue (migration 0381)", () => {
    expect(escolherAcaoDeConversao("recorrente", { avulsa: "111", recorrente: null })).toBe("111");
  });

  it("sem nenhuma ação cadastrada, devolve null — quem chama decide o que fazer", () => {
    expect(escolherAcaoDeConversao("avulsa", { avulsa: null, recorrente: null })).toBeNull();
    expect(escolherAcaoDeConversao("recorrente", { avulsa: null, recorrente: null })).toBeNull();
  });
});
