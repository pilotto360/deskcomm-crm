import { describe, expect, it } from "vitest";

import { INTERNOS } from "./cobranca";

const { mensagemDeErro, hojeISO } = INTERNOS;

describe("leitura de erro do Asaas", () => {
  it("lê a descrição do primeiro erro da lista", () => {
    expect(mensagemDeErro({ errors: [{ description: "CPF inválido", code: "invalid_cpf" }] })).toBe(
      "CPF inválido",
    );
  });

  it("cai para o code quando não há description", () => {
    expect(mensagemDeErro({ errors: [{ code: "invalid_cpf" }] })).toBe("invalid_cpf");
  });

  it("corpo sem o formato esperado devolve mensagem genérica, nunca lança", () => {
    expect(mensagemDeErro(null)).toBe("erro sem formato reconhecido");
    expect(mensagemDeErro({ raw: "<html>404</html>" })).toBe("erro sem formato reconhecido");
    expect(mensagemDeErro({ errors: [] })).toBe("erro sem formato reconhecido");
  });
});

describe("data de vencimento da cobrança Pix", () => {
  it("devolve yyyy-MM-dd", () => {
    expect(hojeISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
