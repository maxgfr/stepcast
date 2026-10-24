/**
 * The player's own words, in the demo's language: the 16 languages AI mode
 * writes in (llm-connect's RESPONSE_LANGUAGES). Kept here, not imported, so the
 * standalone player stays small.
 */
export interface PlayerLabels {
  start: string;
  next: string;
  back: string;
  finish: string;
  replay: string;
  /** Title of the end card when the demo has none. */
  end: string;
  /** Accessible name of a hotspot: "Next: <step title>". */
  nextStep: string;
  made: string;
}

const LABELS: Record<string, PlayerLabels> = {
  en: {
    start: "Start",
    next: "Next",
    back: "Back",
    finish: "Finish",
    replay: "Replay",
    end: "That's the tour",
    nextStep: "Next step",
    made: "Made with stepcast",
  },
  fr: {
    start: "Commencer",
    next: "Suivant",
    back: "Retour",
    finish: "Terminer",
    replay: "Revoir",
    end: "C'est la fin de la visite",
    nextStep: "Étape suivante",
    made: "Fait avec stepcast",
  },
  es: {
    start: "Empezar",
    next: "Siguiente",
    back: "Atrás",
    finish: "Terminar",
    replay: "Repetir",
    end: "Fin del recorrido",
    nextStep: "Paso siguiente",
    made: "Hecho con stepcast",
  },
  de: {
    start: "Starten",
    next: "Weiter",
    back: "Zurück",
    finish: "Fertig",
    replay: "Nochmal",
    end: "Das war die Tour",
    nextStep: "Nächster Schritt",
    made: "Erstellt mit stepcast",
  },
  it: {
    start: "Inizia",
    next: "Avanti",
    back: "Indietro",
    finish: "Fine",
    replay: "Rivedi",
    end: "Fine del tour",
    nextStep: "Passo successivo",
    made: "Creato con stepcast",
  },
  pt: {
    start: "Começar",
    next: "Seguinte",
    back: "Voltar",
    finish: "Concluir",
    replay: "Rever",
    end: "Fim da visita",
    nextStep: "Próximo passo",
    made: "Feito com stepcast",
  },
  nl: {
    start: "Starten",
    next: "Volgende",
    back: "Terug",
    finish: "Klaar",
    replay: "Opnieuw",
    end: "Dat was de rondleiding",
    nextStep: "Volgende stap",
    made: "Gemaakt met stepcast",
  },
  ru: {
    start: "Начать",
    next: "Далее",
    back: "Назад",
    finish: "Готово",
    replay: "Сначала",
    end: "Обзор завершён",
    nextStep: "Следующий шаг",
    made: "Сделано в stepcast",
  },
  zh: {
    start: "开始",
    next: "下一步",
    back: "上一步",
    finish: "完成",
    replay: "重播",
    end: "演示结束",
    nextStep: "下一步",
    made: "由 stepcast 制作",
  },
  ja: {
    start: "開始",
    next: "次へ",
    back: "戻る",
    finish: "完了",
    replay: "もう一度",
    end: "ツアーは以上です",
    nextStep: "次のステップ",
    made: "stepcast で作成",
  },
  ko: {
    start: "시작",
    next: "다음",
    back: "이전",
    finish: "완료",
    replay: "다시 보기",
    end: "투어가 끝났습니다",
    nextStep: "다음 단계",
    made: "stepcast로 제작",
  },
  ar: {
    start: "ابدأ",
    next: "التالي",
    back: "السابق",
    finish: "إنهاء",
    replay: "إعادة",
    end: "انتهت الجولة",
    nextStep: "الخطوة التالية",
    made: "صُنع باستخدام stepcast",
  },
  hi: {
    start: "शुरू करें",
    next: "आगे",
    back: "पीछे",
    finish: "समाप्त",
    replay: "फिर से देखें",
    end: "टूर समाप्त",
    nextStep: "अगला चरण",
    made: "stepcast से बनाया गया",
  },
  tr: {
    start: "Başla",
    next: "İleri",
    back: "Geri",
    finish: "Bitir",
    replay: "Tekrar izle",
    end: "Tur bitti",
    nextStep: "Sonraki adım",
    made: "stepcast ile yapıldı",
  },
  pl: {
    start: "Rozpocznij",
    next: "Dalej",
    back: "Wstecz",
    finish: "Zakończ",
    replay: "Od nowa",
    end: "To koniec prezentacji",
    nextStep: "Następny krok",
    made: "Stworzone w stepcast",
  },
  sv: {
    start: "Starta",
    next: "Nästa",
    back: "Tillbaka",
    finish: "Klar",
    replay: "Spela igen",
    end: "Det var rundturen",
    nextStep: "Nästa steg",
    made: "Skapad med stepcast",
  },
};

/** The language part of a code ("fr-CA" → "fr"). */
const base = (code: string | undefined) => (code ?? "en").toLowerCase().split(/[-_]/)[0] ?? "en";

export function playerLabels(code: string | undefined): PlayerLabels {
  return LABELS[base(code)] ?? (LABELS.en as PlayerLabels);
}

export function isRtl(code: string | undefined): boolean {
  return ["ar", "he", "fa", "ur"].includes(base(code));
}

export const PLAYER_LANGUAGES = Object.keys(LABELS);
