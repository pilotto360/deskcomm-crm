import { describe, expect, it } from "vitest";
import {
  suggestDefaultMapping,
  resolveValueFromRule,
  resolveTemplateVariables,
  type VariableMappingRule,
  type TemplateVariableMappings,
} from "@/lib/channels/template-mapping";

describe("template-mapping", () => {
  it("suggests correct default mapping based on key and expectations", () => {
    expect(suggestDefaultMapping("primeiro_nome")).toEqual({
      source: "contact.first_name",
    });
    expect(suggestDefaultMapping("1", "image")).toEqual({
      source: "fixed",
    });
    expect(suggestDefaultMapping("telefone")).toEqual({
      source: "contact.phone_number",
    });
    expect(suggestDefaultMapping("email")).toEqual({
      source: "contact.email",
    });
  });

  it("resolves values correctly from contact data", () => {
    const contact = {
      name: "Roberto Silva",
      phone_number: "+5519994269101",
      email: "roberto@example.com",
      custom_fields: { codigo: "CUST-123" },
    };

    expect(
      resolveValueFromRule({ source: "contact.first_name" }, { contact }),
    ).toBe("Roberto");

    expect(
      resolveValueFromRule({ source: "contact.name" }, { contact }),
    ).toBe("Roberto Silva");

    expect(
      resolveValueFromRule({ source: "contact.phone_number" }, { contact }),
    ).toBe("+5519994269101");

    expect(
      resolveValueFromRule(
        { source: "contact.custom_field", customFieldKey: "codigo" },
        { contact },
      ),
    ).toBe("CUST-123");

    expect(
      resolveValueFromRule(
        { source: "fixed", fixedValue: "https://example.com/banner.png" },
        {},
      ),
    ).toBe("https://example.com/banner.png");
  });

  it("resolves all slot variables combining overrides and mappings", () => {
    const contact = { name: "Maria Clara", phone_number: "1999999999" };
    const mappings: TemplateVariableMappings = {
      empresa: { source: "fixed", fixedValue: "Esperança e Vida" },
      nome_cliente: { source: "contact.name" },
    };

    const result = resolveTemplateVariables({
      rawValues: { cupom: "PROMO10" },
      mappings,
      slotKeys: ["cupom", "empresa", "nome_cliente", "primeiro_nome"],
      ctx: { contact },
    });

    expect(result).toEqual({
      cupom: "PROMO10",
      empresa: "Esperança e Vida",
      nome_cliente: "Maria Clara",
      primeiro_nome: "Maria",
    });
  });
});
