"use client";
/**
 * A configuração do gatilho "Mensagem com palavra-chave" (fase 4, 4.1) — a
 * MESMA peça na gaveta (`RuleEditor`) e no designer (`PainelDaCaixa`).
 *
 * O campo de palavras é TEXTO (uma por linha ou separadas por vírgula) e vira
 * lista só ao salvar, por `palavrasDaTela`: assim a vírgula que a pessoa está
 * digitando não some no meio da digitação.
 */
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import {
  MODOS_DA_PALAVRA_CHAVE,
  PALAVRAS_MAX,
  palavrasDaTela,
  type ModoDaPalavraChave,
  type TelaDaPalavraChave,
} from "@/lib/automation/gatilho-palavra-chave";

export {
  TELA_DA_PALAVRA_CHAVE_VAZIA,
  configDaTelaDaPalavraChave,
  telaDaPalavraChave,
  type TelaDaPalavraChave,
} from "@/lib/automation/gatilho-palavra-chave";

const ROTULO_DO_MODO: Record<ModoDaPalavraChave, string> = {
  contem: "Contém a palavra",
  exata: "É exatamente a palavra",
  comeca_com: "Começa com a palavra",
};

export function PalavraChaveDoGatilho({
  tela,
  onChange,
  idPrefixo,
}: {
  tela: TelaDaPalavraChave;
  onChange: (tela: TelaDaPalavraChave) => void;
  idPrefixo: string;
}) {
  const t = useT();
  const quantas = palavrasDaTela(tela.texto).length;
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor={`${idPrefixo}-palavras`}>{t("Palavras-chave")}</Label>
        <Textarea
          id={`${idPrefixo}-palavras`}
          value={tela.texto}
          rows={3}
          placeholder={t("preço, valor, orçamento")}
          onChange={(e) => onChange({ ...tela, texto: e.target.value })}
        />
        <p className="text-xs text-text-muted">
          {t("Uma por linha ou separadas por vírgula. A automação roda quando a mensagem do cliente tiver qualquer uma delas.")}{" "}
          <span className={quantas > PALAVRAS_MAX ? "text-error-fg" : undefined}>
            {quantas}/{PALAVRAS_MAX}
          </span>
        </p>
      </div>
      <div className="space-y-1">
        <Label>{t("Como comparar")}</Label>
        <Select value={tela.modo} onValueChange={(v) => onChange({ ...tela, modo: v as ModoDaPalavraChave })}>
          <SelectTrigger aria-label={t("Como comparar")} className="min-h-11 lg:min-h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODOS_DA_PALAVRA_CHAVE.map((modo) => (
              <SelectItem key={modo} value={modo}>
                {t(ROTULO_DO_MODO[modo])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex min-h-11 items-center justify-between gap-3 lg:min-h-0">
        <Label htmlFor={`${idPrefixo}-acentos`} className="font-normal">
          {t("Ignorar acentos e maiúsculas")}
        </Label>
        <Switch
          id={`${idPrefixo}-acentos`}
          checked={tela.ignorarAcentos}
          onCheckedChange={(v) => onChange({ ...tela, ignorarAcentos: v })}
        />
      </div>
      <p className="text-xs text-text-muted">
        {t("Só vale para mensagem recebida do cliente. Mensagens de grupo e as enviadas pela equipe não disparam.")}
      </p>
    </div>
  );
}

