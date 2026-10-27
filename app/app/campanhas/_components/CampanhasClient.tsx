"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Megaphone,
  Play,
  Pause,
  Plus,
  PaperPlaneTilt,
  ArrowsClockwise,
  CheckCircle,
  Clock,
  Users,
  ShieldCheck,
  Funnel,
  Sparkle,
  ChatCircleText,
} from "@/lib/ui/icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCampaigns } from "@/hooks/campaigns/useCampaigns";
import { useChannelSessions, channelLabel } from "@/hooks/channels/useChannelSessions";
import { useContactTagVocabulary } from "@/hooks/contacts/useContactTagVocabulary";
import type { CampaignWithStats } from "@/lib/campaigns/types";

interface CampanhasClientProps {
  podeGerenciar: boolean;
  orgId: string;
}

export function CampanhasClient({ podeGerenciar, orgId }: CampanhasClientProps) {
  const {
    campaigns,
    carregando,
    recarregar,
    criarCampanha,
    atualizarCampanha,
    dispararProximo,
    emCriacao,
    emDisparo,
  } = useCampaigns();

  const { data: channels = [] } = useChannelSessions();
  const { data: tags = [] } = useContactTagVocabulary(orgId);

  const [modalCriacaoAberto, setModalCriacaoAberto] = useState(false);
  const [nome, setNome] = useState("Reativação Esperança e Vida - 25/dia");
  const [canalId, setCanalId] = useState("");
  const [tagEscolhida, setTagEscolhida] = useState("recadastramento_pendente");
  const [tetoDiario, setTetoDiario] = useState(25);
  const [intervaloMin, setIntervaloMin] = useState(20);
  const [horaInicio, setHoraInicio] = useState(9);
  const [horaFim, setHoraFim] = useState(18);
  const [mensagem, setMensagem] = useState(
    "Olá, {{primeiro_nome}}. Aqui é da Associação Esperança e Vida. 💚\n\nVocê já fez parte da nossa história e estamos atualizando nosso cadastro para manter por perto somente quem deseja continuar acompanhando o trabalho da Associação.\n\nVocê gostaria de continuar recebendo nossas mensagens pelo WhatsApp?",
  );

  // Totais agregados
  const totalContatos = campaigns.reduce((acc, c) => acc + (c.total_recipients || 0), 0);
  const totalEnviadosHoje = campaigns.reduce((acc, c) => acc + (c.sent_today || 0), 0);
  const totalPendentes = campaigns.reduce((acc, c) => acc + (c.pending_total || 0), 0);
  const ativasCount = campaigns.filter((c) => c.status === "running").length;

  async function handleToggleStatus(c: CampaignWithStats) {
    const novoStatus = c.status === "running" ? "paused" : "running";
    try {
      await atualizarCampanha({ id: c.id, dados: { status: novoStatus } });
      toast.success(novoStatus === "running" ? "Campanha ativada!" : "Campanha pausada!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao alterar status.");
    }
  }

  async function handleDispararTeste(c: CampaignWithStats) {
    try {
      const res = await dispararProximo(c.id);
      if (res.result.dispatched) {
        toast.success(
          `Disparo realizado com sucesso para ${res.result.contactName || res.result.phone || "o próximo contato"}!`,
        );
      } else {
        toast.info(res.result.reason || "Disparo não elegível no momento.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao realizar disparo de teste.");
    }
  }

  async function handleCriarCampanha() {
    if (!nome.trim()) {
      toast.error("Informe um nome para a campanha.");
      return;
    }
    const targetChannel = canalId || (channels[0]?.id ?? "");
    if (!targetChannel) {
      toast.error("Selecione um canal de WhatsApp conectado.");
      return;
    }
    if (!tagEscolhida) {
      toast.error("Selecione uma tag de audiência.");
      return;
    }
    if (!mensagem.trim()) {
      toast.error("O texto da mensagem é obrigatório.");
      return;
    }

    try {
      await criarCampanha({
        name: nome.trim(),
        channel_session_id: targetChannel,
        tag: tagEscolhida,
        message_body: mensagem.trim(),
        teto_diario: tetoDiario,
        intervalo_segundos: intervaloMin * 60,
        janela_inicio_hora: horaInicio,
        janela_fim_hora: horaFim,
        pipeline_id: "b187e86d-56a2-443b-9967-cd21a6ed9813", // Reativação e Relacionamento
        stage_id: "898682d8-017b-4b05-970f-e64915cd3923", // Reativação enviada
        auto_start: true,
      });

      toast.success("Campanha criada e ativada com sucesso!");
      setModalCriacaoAberto(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar campanha.");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Campanhas & Disparos Automáticos</h1>
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
              <Sparkle className="mr-1 h-3 w-3" /> Anti-Ban Ativo
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Automação nativa com ritmo controlado, horário comercial e teto diário (25/dia). Zero movimentação manual.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => recarregar()}
            className="gap-1.5"
            disabled={carregando}
          >
            <ArrowsClockwise className={`h-4 w-4 ${carregando ? "animate-spin" : ""}`} />
            Atualizar
          </Button>

          {podeGerenciar && (
            <Button
              size="sm"
              onClick={() => {
                if (channels.length > 0 && !canalId) {
                  setCanalId(channels[0]?.id ?? "");
                }
                setModalCriacaoAberto(true);
              }}
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              <Plus className="h-4 w-4" />
              Nova Campanha
            </Button>
          )}
        </div>
      </div>

      {/* KPI Cards Banner */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/50 bg-card/40 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Disparados Hoje
            </CardTitle>
            <Clock className="h-4 w-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-400">
              {totalEnviadosHoje} <span className="text-sm font-normal text-muted-foreground">/ 25 máx</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Teto diário por segurança do número</p>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/40 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Na Fila de Espera
            </CardTitle>
            <Users className="h-4 w-4 text-sky-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-sky-400">{totalPendentes.toLocaleString("pt-BR")}</div>
            <p className="mt-1 text-xs text-muted-foreground">Contatos prontos aguardando envio</p>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/40 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Total em Campanhas
            </CardTitle>
            <CheckCircle className="h-4 w-4 text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalContatos.toLocaleString("pt-BR")}</div>
            <p className="mt-1 text-xs text-muted-foreground">Contatos cadastrados nas listas</p>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/40 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Campanhas Ativas
            </CardTitle>
            <Megaphone className="h-4 w-4 text-purple-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-400">{ativasCount}</div>
            <p className="mt-1 text-xs text-muted-foreground">Disparos em andamento no CRM</p>
          </CardContent>
        </Card>
      </div>

      {/* Campaigns Listing */}
      <div className="flex flex-col gap-4">
        {campaigns.length === 0 ? (
          <Card className="border-dashed border-border/80 bg-card/20 p-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400">
              <Megaphone className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-base font-semibold">Nenhuma campanha criada ainda</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Crie sua primeira campanha para disparar automaticamente as mensagens de reativação para os 2.581 contatos
              com a tag <code className="text-emerald-400">recadastramento_pendente</code>.
            </p>
            {podeGerenciar && (
              <Button
                onClick={() => {
                  if (channels.length > 0 && !canalId) {
                    setCanalId(channels[0]?.id ?? "");
                  }
                  setModalCriacaoAberto(true);
                }}
                className="mx-auto mt-4 gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                <Plus className="h-4 w-4" />
                Criar Campanha de Reativação
              </Button>
            )}
          </Card>
        ) : (
          campaigns.map((c) => {
            const pctHoje = c.teto_diario ? Math.min(100, Math.round((c.sent_today / c.teto_diario) * 100)) : 0;
            const pctTotal = c.total_recipients ? Math.min(100, Math.round((c.sent_total / c.total_recipients) * 100)) : 0;
            const isAtiva = c.status === "running";

            return (
              <Card
                key={c.id}
                className="overflow-hidden border border-border/60 bg-gradient-to-b from-card/80 to-card/40 shadow-sm"
              >
                <div className="flex flex-col gap-4 p-5 lg:p-6">
                  {/* Top line: Name, Status, Action Buttons */}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2.5">
                        <span className="font-semibold text-lg tracking-tight">{c.name}</span>
                        {isAtiva ? (
                          <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 gap-1.5 py-0.5">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            Ativa • Disparando
                          </Badge>
                        ) : c.status === "paused" ? (
                          <Badge variant="outline" className="border-amber-500/30 text-amber-400 bg-amber-500/10">
                            Pausada
                          </Badge>
                        ) : (
                          <Badge variant="secondary">{c.status}</Badge>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground flex items-center gap-2">
                        <span>Canal: <strong className="text-foreground">{c.channel_name || "WhatsApp"}</strong></span>
                        <span>•</span>
                        <span>Filtro: <code className="text-emerald-400">{c.audience_filter?.tag || "Todos"}</code></span>
                        {c.pipeline_name && (
                          <>
                            <span>•</span>
                            <span>Funil: {c.pipeline_name} › {c.stage_name}</span>
                          </>
                        )}
                      </p>
                    </div>

                    {/* Quick controls */}
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDispararTeste(c)}
                        disabled={emDisparo || c.pending_total === 0}
                        className="gap-1 text-xs"
                        title="Envia 1 mensagem de teste imediatamente para o próximo contato da fila"
                      >
                        <PaperPlaneTilt className="h-3.5 w-3.5 text-sky-400" />
                        Disparar 1 Agora (Teste)
                      </Button>

                      {podeGerenciar && (
                        <Button
                          variant={isAtiva ? "outline" : "default"}
                          size="sm"
                          onClick={() => handleToggleStatus(c)}
                          className={isAtiva ? "border-amber-500/40 text-amber-400 hover:bg-amber-500/10" : "bg-emerald-600 hover:bg-emerald-500 text-white"}
                        >
                          {isAtiva ? (
                            <>
                              <Pause className="mr-1.5 h-3.5 w-3.5" /> Pausar
                            </>
                          ) : (
                            <>
                              <Play className="mr-1.5 h-3.5 w-3.5" /> Iniciar
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Progress Bars */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 pt-2">
                    {/* Hoje */}
                    <div className="rounded-lg border border-border/40 bg-background/50 p-3.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-muted-foreground">Progresso de Hoje:</span>
                        <span className="font-semibold text-emerald-400">
                          {c.sent_today} / {c.teto_diario} ({pctHoje}%)
                        </span>
                      </div>
                      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-emerald-500 transition-all duration-500 rounded-full"
                          style={{ width: `${pctHoje}%` }}
                        />
                      </div>
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        {c.sent_today >= (c.teto_diario || 25)
                          ? "✓ Teto diário de 25 atingido! Próximo envio amanhã às 09:00."
                          : `Restam ${Math.max(0, (c.teto_diario || 25) - c.sent_today)} envios para hoje.`}
                      </p>
                    </div>

                    {/* Total da Fila */}
                    <div className="rounded-lg border border-border/40 bg-background/50 p-3.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-muted-foreground">Total da Base:</span>
                        <span className="font-semibold text-sky-400">
                          {c.sent_total} / {c.total_recipients} ({pctTotal}%)
                        </span>
                      </div>
                      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-sky-500 transition-all duration-500 rounded-full"
                          style={{ width: `${pctTotal}%` }}
                        />
                      </div>
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        {c.pending_total} contatos restantes na fila.
                      </p>
                    </div>
                  </div>

                  {/* Rules and Configuration Pills */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <span className="inline-flex items-center gap-1 rounded-md bg-secondary/60 px-2 py-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3 text-emerald-400" />
                      {c.janela_inicio_hora}h às {c.janela_fim_hora}h (Segunda a Sexta)
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-secondary/60 px-2 py-1 text-xs text-muted-foreground">
                      <ShieldCheck className="h-3 w-3 text-sky-400" />
                      Intervalo ~{Math.round((c.intervalo_segundos || 1200) / 60)} min ± 20% jitter anti-ban
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-secondary/60 px-2 py-1 text-xs text-muted-foreground">
                      <Funnel className="h-3 w-3 text-amber-400" />
                      Ao responder: IA assume e move para Respondeu
                    </span>
                  </div>

                  {/* WhatsApp Message Preview Bubble */}
                  <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-950/10 p-3.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-400 mb-2">
                      <ChatCircleText className="h-4 w-4" />
                      Mensagem enviada no WhatsApp:
                    </div>
                    <div className="rounded-lg bg-[#005c4b]/30 border border-[#005c4b]/40 p-3 text-sm text-[#e9edef] whitespace-pre-wrap leading-relaxed max-w-2xl font-sans">
                      {c.message_body || "Sem mensagem configurada."}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* Modal / Dialog de Criação de Campanha */}
      <Dialog open={modalCriacaoAberto} onOpenChange={setModalCriacaoAberto}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova Campanha Automática</DialogTitle>
            <DialogDescription>
              Configure os disparos controlados para sua base de contatos com ritmo anti-ban.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="camp-nome">Nome da Campanha</Label>
              <Input
                id="camp-nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex: Reativação Esperança e Vida"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Canal de WhatsApp</Label>
                <Select value={canalId} onValueChange={setCanalId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o canal" />
                  </SelectTrigger>
                  <SelectContent>
                    {channels.map((ch) => (
                      <SelectItem key={ch.id} value={ch.id}>
                        {channelLabel(ch)} ({ch.phone_number || "Conectado"})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Tag do Público-Alvo</Label>
                <Select value={tagEscolhida} onValueChange={setTagEscolhida}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a tag" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="recadastramento_pendente">
                      recadastramento_pendente (2.581 contatos)
                    </SelectItem>
                    <SelectItem value="pronto_whatsapp">
                      pronto_whatsapp (3.047 contatos)
                    </SelectItem>
                    {tags
                      .filter((t) => t !== "recadastramento_pendente" && t !== "pronto_whatsapp")
                      .map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="teto">Teto Diário (Envios/dia)</Label>
                <Input
                  id="teto"
                  type="number"
                  min={1}
                  max={200}
                  value={tetoDiario}
                  onChange={(e) => setTetoDiario(parseInt(e.target.value || "25", 10))}
                />
                <span className="text-[11px] text-muted-foreground">Recomendado: 25/dia</span>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="intervalo">Intervalo Médio (min)</Label>
                <Input
                  id="intervalo"
                  type="number"
                  min={2}
                  max={120}
                  value={intervaloMin}
                  onChange={(e) => setIntervaloMin(parseInt(e.target.value || "20", 10))}
                />
                <span className="text-[11px] text-muted-foreground">Com variação natural</span>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Janela Comercial</Label>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={horaInicio}
                    onChange={(e) => setHoraInicio(parseInt(e.target.value || "9", 10))}
                    className="w-16 text-center px-1"
                  />
                  <span className="text-xs text-muted-foreground">às</span>
                  <Input
                    type="number"
                    min={1}
                    max={24}
                    value={horaFim}
                    onChange={(e) => setHoraFim(parseInt(e.target.value || "18", 10))}
                    className="w-16 text-center px-1"
                  />
                </div>
                <span className="text-[11px] text-muted-foreground">Segunda a Sexta</span>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="camp-msg">Mensagem WhatsApp</Label>
                <span className="text-[11px] text-emerald-400 font-mono">Variável: {"{{primeiro_nome}}"}</span>
              </div>
              <Textarea
                id="camp-msg"
                rows={5}
                value={mensagem}
                onChange={(e) => setMensagem(e.target.value)}
                placeholder="Escreva a mensagem que será enviada aos contatos..."
                className="font-sans leading-relaxed"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalCriacaoAberto(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleCriarCampanha}
              disabled={emCriacao}
              className="bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5"
            >
              {emCriacao ? (
                <>
                  <ArrowsClockwise className="h-4 w-4 animate-spin" /> Criando...
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4" /> Criar e Ativar Disparos
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
