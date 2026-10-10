"use client";

/**
 * O componente cliente do checkout: formulário de doador -> cria a intenção
 * via `POST /api/v1/checkout/[org]/intents` -> mostra QR/copia-e-cola ->
 * faz polling de `GET .../intents/[id]` até `status === 'reported' | 'paid'`.
 *
 * Sem framework de formulário (a página não tem o resto do app carregado) —
 * estado local simples é suficiente para os quatro campos que existem.
 */
import { useEffect, useRef, useState } from "react";

interface Props {
  org: string;
  gclid: string | null;
  utm: Record<string, string>;
}

type Etapa =
  | { tipo: "formulario" }
  | { tipo: "enviando" }
  | { tipo: "erro"; mensagem: string }
  | {
      tipo: "aguardando_pagamento";
      intentId: string;
      copiaECola: string;
      qrCodeBase64: string;
    }
  | { tipo: "confirmado" };

const POLL_MS = 4000;

export function CheckoutDoacao({ org, gclid, utm }: Props) {
  const [etapa, setEtapa] = useState<Etapa>({ tipo: "formulario" });
  const [tipoDoacao, setTipoDoacao] = useState<"avulsa" | "recorrente">("avulsa");
  const [valorReais, setValorReais] = useState("50");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [documento, setDocumento] = useState("");

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const valorCentavos = Math.round(Number(valorReais.replace(",", ".")) * 100);
    if (!valorCentavos || valorCentavos <= 0) {
      setEtapa({ tipo: "erro", mensagem: "Informe um valor válido." });
      return;
    }

    setEtapa({ tipo: "enviando" });
    try {
      const resposta = await fetch(`/api/v1/checkout/${encodeURIComponent(org)}/intents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          valor_centavos: valorCentavos,
          moeda: "BRL",
          tipo: tipoDoacao,
          gclid,
          utm,
          pagador: { nome, email: email || null, documento },
        }),
      });
      const corpo = await resposta.json().catch(() => null);
      if (!resposta.ok || !corpo?.data) {
        setEtapa({ tipo: "erro", mensagem: corpo?.error?.message ?? "Não foi possível gerar o Pix agora." });
        return;
      }

      setEtapa({
        tipo: "aguardando_pagamento",
        intentId: corpo.data.intent_id,
        copiaECola: corpo.data.copia_e_cola,
        qrCodeBase64: corpo.data.qr_code_base64,
      });

      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`/api/v1/checkout/${encodeURIComponent(org)}/intents/${corpo.data.intent_id}`);
          const j = await r.json().catch(() => null);
          const status = j?.data?.status;
          if (status === "paid" || status === "reported") {
            if (pollRef.current) clearInterval(pollRef.current);
            setEtapa({ tipo: "confirmado" });
          }
        } catch {
          // Falha de rede pontual no polling não interrompe a espera — a
          // próxima batida tenta de novo.
        }
      }, POLL_MS);
    } catch {
      setEtapa({ tipo: "erro", mensagem: "Falha de conexão. Tente novamente." });
    }
  }

  const caixa: React.CSSProperties = {
    background: "#fff",
    borderRadius: 12,
    padding: "2rem",
    maxWidth: 420,
    width: "100%",
    boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
  };

  if (etapa.tipo === "confirmado") {
    return (
      <div style={caixa}>
        <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>Obrigado pela sua doação!</h1>
        <p style={{ color: "#555" }}>Seu Pix foi confirmado. Sua generosidade faz a diferença.</p>
      </div>
    );
  }

  if (etapa.tipo === "aguardando_pagamento") {
    return (
      <div style={{ ...caixa, textAlign: "center" }}>
        <h1 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Escaneie para pagar com Pix</h1>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`data:image/png;base64,${etapa.qrCodeBase64}`}
          alt="QR Code Pix"
          style={{ width: 220, height: 220, margin: "0 auto" }}
        />
        <p style={{ fontSize: "0.85rem", color: "#666", margin: "1rem 0 0.5rem" }}>
          Ou copie o código:
        </p>
        <textarea
          readOnly
          value={etapa.copiaECola}
          onFocus={(e) => e.currentTarget.select()}
          style={{ width: "100%", height: 70, fontSize: "0.75rem", padding: 8 }}
        />
        <p style={{ fontSize: "0.8rem", color: "#888", marginTop: "1rem" }}>
          Aguardando confirmação do pagamento…
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} style={caixa}>
      <h1 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>Fazer uma doação</h1>

      <div style={{ display: "flex", gap: 8, marginBottom: "1rem" }}>
        <button
          type="button"
          onClick={() => setTipoDoacao("avulsa")}
          style={{
            flex: 1,
            padding: "0.5rem",
            borderRadius: 8,
            border: tipoDoacao === "avulsa" ? "2px solid #2563eb" : "1px solid #ccc",
            background: "#fff",
          }}
        >
          Avulsa
        </button>
        <button
          type="button"
          onClick={() => setTipoDoacao("recorrente")}
          style={{
            flex: 1,
            padding: "0.5rem",
            borderRadius: 8,
            border: tipoDoacao === "recorrente" ? "2px solid #2563eb" : "1px solid #ccc",
            background: "#fff",
          }}
        >
          Mensal
        </button>
      </div>

      <label style={{ display: "block", fontSize: "0.85rem", marginBottom: 4 }}>Valor (R$)</label>
      <input
        type="text"
        inputMode="decimal"
        value={valorReais}
        onChange={(e) => setValorReais(e.target.value)}
        style={{ width: "100%", padding: "0.6rem", marginBottom: "0.75rem", borderRadius: 8, border: "1px solid #ccc" }}
        required
      />

      <label style={{ display: "block", fontSize: "0.85rem", marginBottom: 4 }}>Nome completo</label>
      <input
        type="text"
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        style={{ width: "100%", padding: "0.6rem", marginBottom: "0.75rem", borderRadius: 8, border: "1px solid #ccc" }}
        required
      />

      <label style={{ display: "block", fontSize: "0.85rem", marginBottom: 4 }}>E-mail</label>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ width: "100%", padding: "0.6rem", marginBottom: "0.75rem", borderRadius: 8, border: "1px solid #ccc" }}
      />

      <label style={{ display: "block", fontSize: "0.85rem", marginBottom: 4 }}>CPF</label>
      <input
        type="text"
        inputMode="numeric"
        value={documento}
        onChange={(e) => setDocumento(e.target.value)}
        style={{ width: "100%", padding: "0.6rem", marginBottom: "1rem", borderRadius: 8, border: "1px solid #ccc" }}
        required
      />

      {etapa.tipo === "erro" && (
        <p style={{ color: "#c00", fontSize: "0.85rem", marginBottom: "0.75rem" }}>{etapa.mensagem}</p>
      )}

      <button
        type="submit"
        disabled={etapa.tipo === "enviando"}
        style={{
          width: "100%",
          padding: "0.75rem",
          borderRadius: 8,
          border: "none",
          background: "#2563eb",
          color: "#fff",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {etapa.tipo === "enviando" ? "Gerando Pix…" : "Gerar Pix"}
      </button>
    </form>
  );
}
