/**
 * Durações dos relatórios. A resolução de um atendimento vai de minutos a
 * dias, e "2880min" não se lê: a unidade sobe com o tamanho, com no máximo
 * duas casas ("1 d 4 h", "3 h 20 min", "45 s"). `null` é "—" (não medido),
 * nunca "0 s".
 */
export function formatarTempo(segundos: number | null | undefined): string {
  if (segundos === null || segundos === undefined || !Number.isFinite(segundos)) return "—";
  const s = Math.max(0, Math.round(segundos));
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const restoMin = min % 60;
  if (h < 24) return restoMin ? `${h} h ${restoMin} min` : `${h} h`;
  const d = Math.floor(h / 24);
  const restoH = h % 24;
  return restoH ? `${d} d ${restoH} h` : `${d} d`;
}

/** `YYYY-MM-DD` como dia curto no idioma de quem lê (a data já é civil: sem fuso). */
export function diaCurto(dia: string, tagDeIdioma: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return dia;
  return d.toLocaleDateString(tagDeIdioma, { day: "2-digit", month: "2-digit", timeZone: "UTC" });
}
