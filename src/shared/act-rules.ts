import { ACTING_LIMITS, ACTS, type Act, type Refusal, type SnapElement, type TurnReply, type TurnRequest } from "./types.ts";

// The pure half of acting's safety gate (DESIGN section 4): which words
// commit, which are safe, whether a value is the visitor's own, and the check
// a reply passes before anything is done with it. No DOM or Node APIs here:
// the widget and the server run the same code. The widget's run is the one
// that counts; the server's is defence in depth and a count of what it caught.

/**
 * What using a control would do, by its words. The hand-over check (DESIGN 4.5)
 * uses the classes again: a commit that is "destroy", "money", "session" or
 * "secret" is handed over only when the visitor's own words hold a word of the
 * same class.
 */
export type CommitClass = "destroy" | "money" | "session" | "send" | "save" | "dataOut" | "secret" | "dialog";

/** The languages whose words ship in the tables. The widget's own sentences are English. */
export const LANGUAGES = ["en", "es", "fr", "de", "pt", "it", "nl", "ja", "zh"] as const;
export type Language = (typeof LANGUAGES)[number];

/** The classes that stop a link. A link cannot post, so a link that saves or sends is a way to a form. */
export const LINK_STOPS: readonly CommitClass[] = ["destroy", "money", "session", "dataOut", "secret"];
/** The classes that stop a control that says it opens a menu, list or dialog. */
export const OPENER_STOPS: readonly CommitClass[] = ["destroy", "money", "session", "secret"];
/** The classes a commit must be asked for in the visitor's words before Haptic hands it over (4.5). */
export const ASKED_CLASSES: readonly CommitClass[] = ["destroy", "money", "session", "secret"];

/** What a commit of each class does, for the sentence that stops at one the visitor did not ask for. */
export const CLASS_DOES: Record<CommitClass, string> = {
  destroy: "deletes or ends something",
  money: "spends or moves money",
  session: "signs you in or out",
  send: "sends something",
  save: "saves something",
  dataOut: "takes data off the page",
  secret: "shows something secret",
  dialog: "answers the page's question",
};

// Words ---------------------------------------------------------------------
//
// Each language's verbs as a button says them (infinitive and imperative), by
// class. Phrases are written with spaces. Japanese and Chinese are matched as
// part of the name, since they are written without spaces; every other
// language is matched by whole words, so "Orders" is not "order".

type Table = Partial<Record<CommitClass, string>>;

const COMMIT: Record<Language, Table> = {
  en: {
    destroy: "delete|remove|discard|erase|destroy|revoke|archive|terminate|deactivate|disable|leave|unsubscribe|freeze|lock|block|suspend|reset|trash|bin|purge|wipe|uninstall|unpublish|void|ban|unlink|detach|kick",
    money: "pay|purchase|buy|order|checkout|check out|place order|transfer|withdraw|deposit|refund|charge|donate|subscribe|upgrade|downgrade|renew|top up|send money",
    session: "sign in|log in|login|signin|sign on|sign out|log out|logout|signout|log off|sign up|signup|register|connect|disconnect|power",
    send: "send|submit|post|publish|share|invite|request|book|schedule|reply|comment|notify|resend|forward|broadcast|leave a comment|leave a review|leave a note|leave a message|leave a reply|leave feedback",
    save: "save|update|apply|confirm|accept|agree|approve|reject|decline|deny|assign|unassign|move|merge|rename|restore|resolve|reopen|enable|activate|unlock|unfreeze|verify|finish|complete|create|issue|generate|add to|import|sync|rotate|mark|duplicate|clone|follow|unfollow|like|unlike|star|unstar|vote|pin|unpin|mute|unmute|upload|set as default|make default|floppy",
    dataOut: "export|download|print|copy|copy link|generate link",
    secret: "reveal|unmask",
    dialog: "ok|okay|yes|done|continue",
  },
  es: {
    destroy: "eliminar|elimina|borrar|borra|suprimir|suprime|descartar|descarta|quitar|quita|archivar|archiva|revocar|revoca|desactivar|desactiva|deshabilitar|deshabilita|bloquear|bloquea|suspender|suspende|restablecer|restablece|abandonar|abandona|dar de baja|darse de baja|congelar|congela|vaciar|destruir",
    money: "pagar|paga|comprar|compra|realizar pedido|hacer pedido|finalizar compra|transferir|transfiere|retirar|retira|depositar|deposita|reembolsar|reembolsa|cobrar|cobra|donar|dona|suscribirse|suscribir|suscribete|mejorar plan|renovar",
    session: "iniciar sesion|cerrar sesion|registrarse|registrate|conectar|conecta|desconectar|desconecta|acceder|entrar|salir",
    send: "enviar|envia|publicar|publica|compartir|comparte|invitar|invita|solicitar|solicita|reservar|reserva|programar|programa|responder|responde|comentar|comenta|notificar|notifica|reenviar",
    save: "guardar|guarda|actualizar|actualiza|aplicar|aplica|confirmar|confirma|aceptar|acepta|aprobar|aprueba|rechazar|rechaza|denegar|deniega|asignar|asigna|mover|mueve|fusionar|combinar|renombrar|restaurar|restaura|resolver|resuelve|reabrir|habilitar|habilita|activar|activa|desbloquear|desbloquea|verificar|verifica|finalizar|finaliza|completar|completa|crear|crea|emitir|emite|generar|genera|anadir a|agregar a|importar|importa|sincronizar|marcar|duplicar|subir|cargar",
    dataOut: "exportar|exporta|descargar|descarga|imprimir|imprime|copiar|copia|copiar enlace|generar enlace",
    secret: "revelar|revela|desenmascarar",
    dialog: "si|ok|continuar|listo|hecho",
  },
  fr: {
    destroy: "supprimer|supprime|supprimez|effacer|efface|retirer|retire|enlever|enleve|jeter|archiver|archive|revoquer|revoque|desactiver|desactive|resilier|resilie|quitter|quitte|desabonner|desinscrire|geler|verrouiller|verrouille|bloquer|bloque|suspendre|suspends|reinitialiser|reinitialise|detruire|vider",
    money: "payer|paie|payez|acheter|achete|achetez|commander|commandez|passer la commande|passer commande|transferer|virer|retirer de l argent|deposer|rembourser|debiter|faire un don|abonner|souscrire|mettre a niveau|renouveler",
    session: "se connecter|connexion|se deconnecter|deconnexion|deconnecter|connecter|inscrire|inscription|s inscrire",
    send: "envoyer|envoie|envoyez|soumettre|soumets|publier|publie|partager|partage|inviter|invite|demander|demande|reserver|reserve|planifier|programmer|repondre|reponds|commenter|commente|notifier|renvoyer",
    save: "enregistrer|enregistre|enregistrez|sauvegarder|sauvegarde|mettre a jour|appliquer|applique|confirmer|confirme|valider|valide|accepter|accepte|approuver|approuve|rejeter|rejette|refuser|refuse|assigner|attribuer|deplacer|fusionner|renommer|restaurer|resoudre|rouvrir|activer|active|deverrouiller|debloquer|verifier|terminer|termine|completer|creer|cree|emettre|generer|ajouter a|ajouter au|importer|synchroniser|marquer|dupliquer|televerser",
    dataOut: "exporter|exporte|telecharger|telecharge|imprimer|imprime|copier|copie|copier le lien|generer un lien",
    secret: "reveler|revele|demasquer",
    dialog: "oui|ok|continuer|termine",
  },
  de: {
    destroy: "loschen|losche|entfernen|entferne|verwerfen|verwirf|archivieren|archiviere|widerrufen|deaktivieren|deaktiviere|kundigen|kundige|beenden|beende|verlassen|abbestellen|sperren|sperre|blockieren|blockiere|aussetzen|zurucksetzen|stornieren|storniere|vernichten|leeren",
    money: "bezahlen|bezahle|zahlen|zahle|kaufen|kaufe|jetzt kaufen|bestellen|bestelle|kostenpflichtig bestellen|zur kasse|uberweisen|uberweise|abheben|einzahlen|erstatten|ruckerstatten|belasten|spenden|abonnieren|upgraden|verlangern",
    session: "anmelden|abmelden|einloggen|ausloggen|registrieren|verbinden|trennen|login|logout",
    send: "senden|sende|absenden|schicken|schicke|einreichen|veroffentlichen|teilen|teile|einladen|lade ein|anfragen|beantragen|buchen|buche|planen|antworten|kommentieren|benachrichtigen",
    save: "speichern|speichere|aktualisieren|ubernehmen|anwenden|bestatigen|bestatige|akzeptieren|zustimmen|genehmigen|freigeben|ablehnen|zuweisen|verschieben|zusammenfuhren|umbenennen|wiederherstellen|losen|erledigen|wieder offnen|aktivieren|aktiviere|entsperren|verifizieren|abschliessen|fertigstellen|erstellen|erstelle|anlegen|ausstellen|generieren|erzeugen|hinzufugen zu|importieren|synchronisieren|markieren|duplizieren|hochladen",
    dataOut: "exportieren|herunterladen|drucken|kopieren|link kopieren",
    secret: "aufdecken|enthullen",
    dialog: "ja|ok|fertig|weiter|fortfahren",
  },
  pt: {
    destroy: "excluir|exclua|apagar|apague|remover|remova|descartar|descarte|arquivar|arquive|revogar|revogue|desativar|desative|encerrar|encerre|abandonar|cancelar inscricao|bloquear|bloqueie|suspender|suspenda|redefinir|redefina|congelar|congele|eliminar|elimine|esvaziar",
    money: "pagar|pague|comprar|compre|finalizar compra|fazer pedido|encomendar|transferir|transfira|sacar|levantar|depositar|deposite|reembolsar|reembolse|cobrar|doar|assinar|assine|fazer upgrade|renovar",
    session: "entrar|iniciar sessao|sair|terminar sessao|cadastrar|cadastre se|registrar|registar|conectar|desconectar|login|logout",
    send: "enviar|envie|submeter|publicar|publique|compartilhar|compartilhe|partilhar|convidar|convide|solicitar|solicite|pedir|reservar|reserve|agendar|agende|responder|responda|comentar|comente|notificar|reenviar",
    save: "salvar|salve|guardar|guarde|atualizar|atualize|aplicar|aplique|confirmar|confirme|aceitar|aceite|concordar|aprovar|aprove|rejeitar|rejeite|recusar|negar|atribuir|atribua|mover|mova|mesclar|renomear|restaurar|resolver|reabrir|ativar|ative|habilitar|desbloquear|verificar|concluir|conclua|finalizar|criar|crie|emitir|emita|gerar|gere|adicionar a|adicionar ao|importar|sincronizar|marcar|duplicar|carregar",
    dataOut: "exportar|exporte|baixar|baixe|imprimir|imprima|copiar|copie|copiar link|gerar link",
    secret: "revelar|revele|desmascarar",
    dialog: "sim|ok|continuar|concluido",
  },
  it: {
    destroy: "elimina|eliminare|cancella|cancellare|rimuovi|rimuovere|scarta|scartare|archivia|archiviare|revoca|revocare|disattiva|disattivare|termina|terminare|abbandona|annulla iscrizione|blocca|bloccare|sospendi|sospendere|reimposta|reimpostare|congela|congelare|svuota|distruggi",
    money: "paga|pagare|acquista|acquistare|compra|comprare|ordina|ordinare|effettua ordine|procedi all acquisto|trasferisci|preleva|deposita|rimborsa|addebita|dona|donare|abbonati|abbonarsi|passa a|rinnova",
    session: "accedi|esci|disconnetti|registrati|connetti|login|logout",
    send: "invia|inviare|pubblica|pubblicare|condividi|condividere|invita|invitare|richiedi|richiedere|prenota|prenotare|pianifica|programma|rispondi|commenta|notifica|reinvia",
    save: "salva|salvare|aggiorna|aggiornare|applica|applicare|conferma|confermare|accetta|accettare|approva|approvare|rifiuta|rifiutare|nega|assegna|assegnare|sposta|spostare|unisci|rinomina|ripristina|risolvi|riapri|abilita|attiva|attivare|sblocca|verifica|completa|completare|crea|creare|emetti|emettere|genera|generare|aggiungi a|aggiungi al|importa|sincronizza|segna|duplica|carica",
    dataOut: "esporta|esportare|scarica|scaricare|stampa|stampare|copia|copiare|copia link",
    secret: "rivela|rivelare|smaschera",
    dialog: "si|ok|continua|fatto",
  },
  nl: {
    destroy: "verwijderen|verwijder|wissen|wis|weggooien|archiveren|archiveer|intrekken|deactiveren|deactiveer|uitschakelen|beeindigen|verlaten|opzeggen|blokkeren|blokkeer|vergrendelen|opschorten|resetten|legen|vernietigen",
    money: "betalen|betaal|kopen|koop|bestellen|bestel|afrekenen|overmaken|opnemen|storten|terugbetalen|doneren|abonneren|upgraden|verlengen",
    session: "inloggen|uitloggen|aanmelden|afmelden|registreren|verbinden|ontkoppelen",
    send: "verzenden|verzend|versturen|verstuur|sturen|stuur|indienen|dien in|publiceren|publiceer|delen|deel|uitnodigen|nodig uit|aanvragen|vraag aan|boeken|boek|inplannen|plannen|beantwoorden|reageren|melden",
    save: "opslaan|sla op|bewaren|bewaar|bijwerken|toepassen|bevestigen|bevestig|accepteren|akkoord|goedkeuren|keur goed|afwijzen|weigeren|toewijzen|verplaatsen|samenvoegen|hernoemen|herstellen|oplossen|heropenen|inschakelen|activeren|activeer|ontgrendelen|verifieren|voltooien|afronden|aanmaken|maak aan|uitgeven|genereren|toevoegen aan|importeren|synchroniseren|markeren|dupliceren|uploaden",
    dataOut: "exporteren|exporteer|downloaden|download|afdrukken|printen|kopieren|kopieer|link kopieren",
    secret: "onthullen|tonen nummer",
    dialog: "ja|ok|doorgaan|klaar|gereed",
  },
  ja: {
    destroy: "削除|消去|破棄|アーカイブ|無効化|無効にする|解約|退会|退出|登録解除|購読解除|配信停止|ブロック|ロック|凍結|停止|リセット|取り消す|取り消し|空にする",
    money: "支払|お支払い|購入|注文|決済|送金|振込|振り込み|出金|入金|返金|請求|寄付|定期購入|購読|アップグレード|更新する|チャージ",
    session: "ログイン|ログアウト|サインイン|サインアウト|サインアップ|新規登録|会員登録|接続|切断",
    send: "送信|送る|提出|投稿|公開|共有|招待|申請|リクエスト|予約|返信|コメント|通知|転送",
    save: "保存|更新|適用|確定|確認|承認|同意|承諾|却下|拒否|割り当て|移動|統合|マージ|名前を変更|復元|解決|再開|有効化|有効にする|ロック解除|認証|完了|作成|発行|生成|に追加|インポート|同期|アップロード",
    dataOut: "エクスポート|ダウンロード|印刷|コピー|リンクをコピー",
    secret: "番号を表示|カード番号を表示|開示",
    dialog: "はい|ok|続行|続ける|完了",
  },
  zh: {
    destroy: "删除|刪除|移除|清除|丢弃|舍弃|归档|撤销|撤銷|吊销|停用|禁用|终止|注销|退出|离开|取消订阅|退订|冻结|凍結|锁定|鎖定|屏蔽|拉黑|暂停|重置|清空",
    money: "支付|付款|购买|購買|立即购买|下单|提交订单|结算|结账|結帳|转账|轉帳|提现|取款|存款|充值|退款|扣款|捐赠|捐款|订阅|訂閱|升级|續訂|续订",
    session: "登录|登入|登出|退出登录|注册|註冊|连接|断开",
    send: "发送|發送|提交|发布|發布|分享|共享|邀请|邀請|申请|申請|请求|预订|预约|預約|安排|回复|回覆|评论|通知|转发",
    save: "保存|储存|儲存|更新|应用|套用|确认|確認|确定|確定|接受|同意|批准|审批|拒绝|拒絕|驳回|分配|指派|移动|合并|重命名|恢复|解决|重新打开|启用|激活|解锁|验证|完成|创建|建立|发行|签发|生成|添加到|加入|导入|同步|上传|复制到",
    dataOut: "导出|匯出|下载|下載|打印|列印|复制|複製|复制链接",
    secret: "显示卡号|查看完整卡号|显示号码|揭示",
    dialog: "是|好|好的|继续|繼續|完成",
  },
};

/** Words of the cancel and close family. Alone they are safe; with a noun of their own ("Cancel order", "Close ticket") they end something. */
const CANCEL_CLOSE = "cancel|close|cancelar|cerrar|annuler|fermer|abbrechen|schliessen|fechar|annulla|chiudi|annuleren|sluiten|キャンセル|閉じる|取消|关闭|關閉";

/** Words that show something, which with a secret's noun reveal it: "Show card number". */
const SHOWS = "show|view|display|see|unhide|mostrar|ver|muestra|afficher|affiche|voir|anzeigen|zeige|einblenden|exibir|visualizar|mostra|visualizza|vedi|tonen|toon|bekijken|weergeven|表示|見る|显示|顯示|查看";
/** What a secret is called: a card's number, a key, a password, a code. */
const SECRET_NOUNS =
  "number|full number|card number|card details|payment details|bank details|key|api key|secret|password|passcode|code|security code|cvc|cvv|pin|token|numero|numero de tarjeta|clave|contrasena|numero de carte|cle|mot de passe|nummer|kartennummer|schlussel|passwort|geheimnis|numero do cartao|chave|senha|numero di carta|chiave|kaartnummer|sleutel|wachtwoord|番号|カード番号|パスワード|暗証番号|キー|号码|卡号|密码|密碼|密钥";

/** Names of things on the screen, not in the data: closing or cancelling one of them ends nothing. */
const UI_NOUNS =
  "dialog|dialogue|modal|window|panel|pane|menu|drawer|sidebar|popup|popover|banner|message|notification|notifications|alert|tooltip|preview|search|filter|filters|tab|view|overlay|step|list|details|help|guide|tour|chat|this|it|dialogo|ventana|menu|aviso|notificacion|mensaje|busqueda|filtro|filtros|pestana|vista|paso|lista|ayuda|fenetre|panneau|recherche|filtre|filtres|onglet|vue|etape|liste|aide|fenster|menu|bereich|seitenleiste|hinweis|benachrichtigung|meldung|nachricht|suche|registerkarte|ansicht|schritt|liste|hilfe|janela|painel|notificacao|mensagem|pesquisa|busca|aba|separador|passo|etapa|ajuda|finestra|pannello|avviso|notifica|messaggio|ricerca|filtri|scheda|passaggio|elenco|aiuto|dialoogvenster|venster|paneel|melding|bericht|zoeken|tabblad|weergave|stap|lijst|ダイアログ|ウィンドウ|メニュー|パネル|通知|メッセージ|検索|フィルター|タブ|画面|对话框|對話框|窗口|視窗|菜单|選單|面板|消息|搜索|筛选|标签页|弹窗";

/** Things a filter panel changes. Removing, resetting or applying one of them is not a change to the data. */
const FILTER_NOUNS = "filter|filters|sort|sorting|search|selection|query|filtro|filtros|busqueda|filtre|filtres|tri|recherche|sortierung|suche|auswahl|busca|pesquisa|ricerca|ordinamento|selezione|zoeken|sortering|selectie";
/** The verbs that, with only those nouns, change the view and not the data. */
const FILTER_VERBS = "remove|reset|apply|clear|quitar|restablecer|aplicar|limpiar|retirer|reinitialiser|appliquer|effacer|entfernen|zurucksetzen|anwenden|ubernehmen|remover|redefinir|limpar|rimuovi|reimposta|applica|cancella|toepassen|resetten|wissen";

/** Safe as the whole name of a button or menu entry (rule 9). With UI nouns or a direction ("Next step", "Close dialog") still safe. */
const SAFE: Record<Language, string> = {
  en: "next|back|previous|prev|cancel|close|dismiss|edit|view|details|more|options|actions|filter|sort|search|expand|collapse|show|hide|preview|help|go back|see more|show more|show less|see all|view all|show all|learn more|read more|more options|more actions|view details|show details|less",
  es: "siguiente|anterior|atras|volver|cancelar|cerrar|editar|ver|detalles|mas|opciones|acciones|filtrar|ordenar|buscar|expandir|contraer|mostrar|ocultar|vista previa|ayuda|ver mas|ver todo|ver detalles",
  fr: "suivant|precedent|retour|annuler|fermer|modifier|voir|afficher|details|plus|options|actions|filtrer|trier|rechercher|developper|reduire|masquer|apercu|aide|voir plus|afficher plus|voir tout|voir les details",
  de: "weiter|zuruck|vorherige|abbrechen|schliessen|bearbeiten|ansehen|anzeigen|details|mehr|optionen|aktionen|filtern|filter|sortieren|suchen|aufklappen|ausklappen|einklappen|zuklappen|ausblenden|einblenden|vorschau|hilfe|mehr anzeigen|alle anzeigen",
  pt: "proximo|seguinte|anterior|voltar|cancelar|fechar|editar|ver|detalhes|mais|opcoes|acoes|filtrar|ordenar|pesquisar|buscar|expandir|recolher|mostrar|ocultar|visualizar|pre visualizar|ajuda|ver mais|ver tudo",
  it: "avanti|successivo|indietro|precedente|annulla|chiudi|modifica|visualizza|vedi|dettagli|altro|opzioni|azioni|filtra|cerca|espandi|comprimi|mostra|nascondi|anteprima|aiuto|mostra di piu|vedi tutto",
  nl: "volgende|vorige|terug|annuleren|sluiten|bewerken|bekijken|details|meer|opties|acties|filteren|sorteren|zoeken|uitvouwen|invouwen|tonen|weergeven|verbergen|voorbeeld|help|meer weergeven|alles bekijken",
  ja: "次へ|次|戻る|前へ|キャンセル|閉じる|編集|表示|詳細|もっと見る|その他|オプション|操作|フィルター|絞り込み|並べ替え|検索|展開|折りたたむ|非表示|プレビュー|ヘルプ",
  zh: "下一步|上一步|返回|取消|关闭|關閉|编辑|編輯|查看|详情|詳情|更多|选项|選項|操作|筛选|過濾|排序|搜索|搜尋|展开|展開|收起|折叠|显示|隱藏|隐藏|预览|預覽|帮助|幫助",
};

/** Words in a name that say nothing about what it does: arrows and icon names, and small words. */
const FILLER =
  "chevron|arrow|caret|angle|icon|right|left|up|down|forward|backward|svg|go|to|the|a|an|my|your|of|for|and|el|la|los|las|un|una|de|del|al|le|les|l|du|des|au|der|die|das|den|dem|zur|zum|o|os|as|do|da|il|lo|gli|i|het|een|naar|van";

/** Small words that carry no meaning of their own, in every shipped language, for grounding and for "Cancel + noun". */
const STOP_WORDS = new Set(
  (
    "a|an|the|of|for|to|in|on|at|by|with|and|or|per|my|your|our|me|its|this|that|is|be|as|from|into|please|can|could|you|would|will|i|we|them|their|her|his|him|she|he|some|each|every|new|called|named|" +
    "el|la|los|las|un|una|unos|unas|de|del|al|por|para|con|y|e|o|u|en|mi|mis|tu|su|sus|que|se|lo|le|les|puedes|podrias|favor|" +
    "le|la|les|l|un|une|des|du|de|d|pour|par|avec|et|ou|en|au|aux|mon|ma|ton|ta|sa|ses|qui|que|ce|cette|s|peux|pourrais|il|elle|" +
    "der|die|das|den|dem|des|ein|eine|einen|einem|einer|fur|pro|mit|und|oder|in|im|zu|zum|zur|von|vom|mein|meine|meinen|dein|sein|ihr|bitte|kannst|konntest|" +
    "o|os|as|um|uma|uns|umas|de|da|do|das|dos|por|para|com|e|ou|em|no|na|nos|nas|meu|minha|seu|sua|pode|podes|voce|" +
    "il|lo|gli|i|un|una|uno|di|del|della|dei|delle|per|con|e|o|in|nel|nella|mio|mia|tuo|suo|puoi|potresti|" +
    "de|het|een|voor|per|met|en|of|in|op|van|mijn|jouw|uw|zijn|haar|kun|kan|alsjeblieft"
  ).split("|"),
);

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+/gu;
/** Particles between Japanese or Chinese words, which a name can hold around the words that matter. */
const CJK_PARTICLES = /[をのにへでがはと的了]/gu;

/** Case, accents and widths folded, so "Löschen", "LOSCHEN" and "loschen" read the same. Accents go only from Latin letters. */
export function fold(text: string): string {
  return text
    .normalize("NFKC")
    .normalize("NFD")
    .replace(/(?<=\p{Script=Latin})\p{M}+/gu, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/ß/g, "ss");
}

/** The words of a folded text that are not Japanese or Chinese. Apostrophes and hyphens split words: "s'inscrire" is "s inscrire". */
function wordsOf(folded: string): string[] {
  return (folded.match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => !CJK.test(word));
}

/** The Japanese and Chinese of a folded text, run together. */
function cjkOf(folded: string): string {
  return (folded.match(CJK_RUN) ?? []).join("");
}

interface Entry {
  /** Latin words in order, or empty for a Japanese or Chinese entry. */
  words: string[];
  /** The entry itself for Japanese and Chinese, matched as part of a name. */
  cjk: string;
  /** How much of a name it covers, so the longest match wins: "Cancel order" over "order". */
  size: number;
}

function entries(list: string): Entry[] {
  return list
    .split("|")
    .map((raw) => fold(raw.trim()))
    .filter(Boolean)
    .map((entry) => (CJK.test(entry) ? { words: [], cjk: cjkOf(entry), size: cjkOf(entry).length } : { words: wordsOf(entry), cjk: "", size: wordsOf(entry).length * 2 }));
}

/** Where a phrase of words starts in `words`, or -1. */
function findWords(words: string[], phrase: string[]): number {
  if (!phrase.length) return -1;
  outer: for (let at = 0; at + phrase.length <= words.length; at++) {
    for (let index = 0; index < phrase.length; index++) if (words[at + index] !== phrase[index]) continue outer;
    return at;
  }
  return -1;
}

function holds(text: { words: string[]; cjk: string }, entry: Entry): boolean {
  return entry.cjk ? text.cjk.includes(entry.cjk) : findWords(text.words, entry.words) >= 0;
}

const CLASSES: CommitClass[] = ["destroy", "money", "session", "secret", "dataOut", "send", "save", "dialog"];
/** Every commit entry, by class, in the order of `CLASSES` (which is also the order of preference between two matches of one size). */
const COMMIT_ENTRIES: { commit: CommitClass; entry: Entry; language: Language }[] = CLASSES.flatMap((commit) =>
  LANGUAGES.flatMap((language) => entries(COMMIT[language][commit] ?? "").map((entry) => ({ commit, entry, language }))),
);
const CANCEL_CLOSE_ENTRIES = entries(CANCEL_CLOSE);
const SHOW_ENTRIES = entries(SHOWS);
const SECRET_NOUN_ENTRIES = entries(SECRET_NOUNS);
const UI_NOUN_WORDS = new Set(entries(UI_NOUNS).flatMap((entry) => entry.words));
const UI_NOUN_CJK = entries(UI_NOUNS).filter((entry) => entry.cjk).map((entry) => entry.cjk);
const FILTER_NOUN_WORDS = new Set(entries(FILTER_NOUNS).flatMap((entry) => entry.words));
const FILTER_VERB_WORDS = new Set(entries(FILTER_VERBS).flatMap((entry) => entry.words));
const FILLER_WORDS = new Set(entries(FILLER).flatMap((entry) => entry.words));
const SAFE_ENTRIES: Entry[] = LANGUAGES.flatMap((language) => entries(SAFE[language])).sort((a, b) => b.size - a.size);

/** The table entries of one language and class, as written, for tests and for anyone checking coverage. */
export function wordsFor(language: Language, commit: CommitClass): string[] {
  return (COMMIT[language][commit] ?? "").split("|").filter(Boolean);
}
/** The safe words of one language, as written. */
export function safeWordsFor(language: Language): string[] {
  return SAFE[language].split("|").filter(Boolean);
}

/** How a control is used, which decides which classes stop it. */
export interface Naming {
  /** It is a link: only `LINK_STOPS` stop it. */
  link?: boolean;
  /** It is in a dialog, where "OK", "Yes", "Done" and "Continue" commit. */
  dialog?: boolean;
  /** It says it opens a menu, list or dialog: only `OPENER_STOPS` stop it. */
  opener?: boolean;
  /** The site's own commit words (`ActingSettings.commitWords`). A match is class "save" and reported as `marked`. */
  extra?: readonly string[];
}

/** What a name says about the control, by the word tables. */
export interface NameVerdict {
  /** The class of the commit word found, if any stops a control used this way. */
  commit?: CommitClass;
  /** The match came from the site's own `commitWords`. */
  marked?: boolean;
  /** The whole name is a safe word or phrase: next, back, cancel, close, edit, ... */
  safe: boolean;
}

/** The class a name's words give it, before what the control is decides whether that class stops it. Undefined when no commit word is there. */
function classOfName(text: { words: string[]; cjk: string }, dialog: boolean): CommitClass | undefined {
  let best: { commit: CommitClass; size: number } | undefined;
  const offer = (commit: CommitClass, size: number) => {
    if (!best || size > best.size) best = { commit, size };
  };
  for (const { commit, entry } of COMMIT_ENTRIES) {
    if (commit === "dialog" && !dialog) continue;
    if (holds(text, entry)) offer(commit, entry.size);
  }
  // "Show card number": a word that shows, and a secret's noun.
  const shows = SHOW_ENTRIES.find((entry) => holds(text, entry));
  const secret = SECRET_NOUN_ENTRIES.filter((entry) => holds(text, entry)).sort((a, b) => b.size - a.size)[0];
  if (shows && secret) offer("secret", shows.size + secret.size);
  // "Cancel order", "Close ticket", "注文をキャンセル": the cancel and close family with a noun of its own.
  const cancel = CANCEL_CLOSE_ENTRIES.find((entry) => holds(text, entry));
  if (cancel) {
    const cancelWords = new Set(CANCEL_CLOSE_ENTRIES.flatMap((entry) => entry.words));
    const others = text.words.filter((word) => !cancelWords.has(word) && !STOP_WORDS.has(word) && !UI_NOUN_WORDS.has(word) && !FILLER_WORDS.has(word) && !/^\d+$/.test(word));
    let rest = text.cjk;
    for (const entry of CANCEL_CLOSE_ENTRIES) if (entry.cjk) rest = rest.split(entry.cjk).join("");
    for (const noun of UI_NOUN_CJK) rest = rest.split(noun).join("");
    rest = rest.replace(CJK_PARTICLES, "");
    if (others.length || rest) offer("destroy", cancel.size + 1);
  }
  // "Remove filter", "Reset filters", "Apply filters" change the view, not the data.
  if (best && (best.commit === "destroy" || best.commit === "save")) {
    const meaningful = text.words.filter((word) => !STOP_WORDS.has(word) && !FILLER_WORDS.has(word));
    if (!text.cjk && meaningful.length >= 2 && meaningful.every((word) => FILTER_VERB_WORDS.has(word) || FILTER_NOUN_WORDS.has(word)) && meaningful.some((word) => FILTER_NOUN_WORDS.has(word))) {
      return undefined;
    }
  }
  return best?.commit;
}

/** Whether the whole name is safe: safe words and phrases, with nothing else but UI nouns, arrows and small words. */
function wholeSafe(text: { words: string[]; cjk: string }): boolean {
  let words = [...text.words];
  let cjk = text.cjk;
  let found = false;
  for (const entry of SAFE_ENTRIES) {
    if (entry.cjk) {
      if (cjk.includes(entry.cjk)) {
        cjk = cjk.split(entry.cjk).join("");
        found = true;
      }
      continue;
    }
    for (let at = findWords(words, entry.words); at >= 0; at = findWords(words, entry.words)) {
      words = [...words.slice(0, at), ...words.slice(at + entry.words.length)];
      found = true;
    }
  }
  for (const noun of UI_NOUN_CJK) cjk = cjk.split(noun).join("");
  cjk = cjk.replace(CJK_PARTICLES, "");
  const left = words.filter((word) => !UI_NOUN_WORDS.has(word) && !FILLER_WORDS.has(word) && !STOP_WORDS.has(word) && !/^\d+$/.test(word));
  return found && !left.length && !cjk;
}

/**
 * Reads a control's name for commit and safe words, in every shipped language.
 * `name` is everything the control is called by, joined: its label, its
 * aria-label, its title and its icon name.
 */
export function readName(name: string, how: Naming = {}): NameVerdict {
  const folded = fold(name);
  const text = { words: wordsOf(folded), cjk: cjkOf(folded) };
  for (const own of how.extra ?? []) {
    const entry = entries(own)[0];
    if (entry && (entry.cjk || entry.words.length) && holds(text, entry)) return { commit: "save", marked: true, safe: false };
  }
  const found = classOfName(text, !!how.dialog);
  if (found) {
    const stops = how.link ? LINK_STOPS : how.opener ? OPENER_STOPS : CLASSES;
    return stops.includes(found) ? { commit: found, safe: false } : { safe: false };
  }
  return { safe: wholeSafe(text) };
}

/** The words of a button that moves a form on to its next part, in every shipped language. */
const FORWARD_ENTRIES = entries(
  "next|next step|continue|siguiente|continuar|suivant|continuer|weiter|fortfahren|proximo|seguinte|avanti|successivo|continua|volgende|doorgaan|次へ|次|続行|下一步|继续|繼續",
);

/**
 * Whether a button's whole name moves a form on: "Next", "Continue",
 * "Siguiente", "次へ". Fields beside such a button wait for it, so changing
 * them saves nothing yet.
 */
export function isForwardName(name: string): boolean {
  const folded = fold(name);
  const words = wordsOf(folded).filter((word) => !FILLER_WORDS.has(word) && !STOP_WORDS.has(word));
  const cjk = cjkOf(folded);
  return FORWARD_ENTRIES.some((entry) => (entry.cjk ? cjk === entry.cjk && !words.length : !cjk && words.join(" ") === entry.words.join(" ")));
}

/**
 * Verbs that start the name of a button that opens something to look at or
 * fill in and changes nothing by itself: "Edit limits", "New budget", "Open
 * expense". "Add" and "Create" are not among them: a button named with them
 * often does it at once.
 */
const OPENING_ENTRIES = entries(
  "open|new|edit|view|manage|browse|preview|" +
    "abrir|nuevo|nueva|editar|ver|gestionar|administrar|" +
    "ouvrir|nouveau|nouvelle|modifier|voir|afficher|gerer|" +
    "offnen|neu|neue|neuer|neues|bearbeiten|ansehen|anzeigen|verwalten|" +
    "novo|nova|gerenciar|visualizar|" +
    "apri|nuovo|nuova|modifica|visualizza|vedi|gestisci|" +
    "openen|nieuw|nieuwe|bewerken|bekijken|beheren|" +
    "開く|新規|編集|打开|新建|编辑|查看",
);

/**
 * Whether a button's name says it opens something: it starts with an opening
 * verb ("Edit limits", "New budget", "Open expense", "Nuevo presupuesto") and
 * holds no word of any class that commits. Only a button outside any form is
 * judged by this (gate.ts), and its press is watched: one that sends anything
 * to the site stops acting at once.
 */
export function opensByName(name: string): boolean {
  const folded = fold(name);
  const words = wordsOf(folded).filter((word) => !FILLER_WORDS.has(word));
  const cjk = cjkOf(folded);
  const first = words[0];
  const starts = first !== undefined ? OPENING_ENTRIES.some((entry) => entry.words.length === 1 && entry.words[0] === first) : OPENING_ENTRIES.some((entry) => !!entry.cjk && cjk.startsWith(entry.cjk));
  if (!starts) return false;
  return !readName(name, { dialog: true }).commit;
}

/** The whole names of a button that only puts a dialog away, in every shipped language. */
const DISMISS_ENTRIES = entries(`${CANCEL_CLOSE}|dismiss|not now|no thanks|go back|back|x`);
/** A close drawn as a mark rather than written. */
const CLOSE_MARKS = /^[×✕✖✗╳]$/u;

/**
 * Whether a button's whole name only puts a dialog away: "Cancel", "Close",
 * "Cerrar", "閉じる". Used where a dialog's own title says what its other
 * buttons do.
 */
export function isDismissName(name: string): boolean {
  if (CLOSE_MARKS.test(name.trim())) return true;
  const folded = fold(name);
  const words = wordsOf(folded).filter((word) => !FILLER_WORDS.has(word) && !STOP_WORDS.has(word));
  const cjk = cjkOf(folded);
  return DISMISS_ENTRIES.some((entry) => (entry.cjk ? cjk === entry.cjk && !words.length : !cjk && words.length > 0 && words.join(" ") === entry.words.join(" ")));
}

/** Words a visitor uses for asking a class of thing, besides the class's own verbs: "my subscription", "the payment". */
const ASKED_TOO: Partial<Record<CommitClass, string>> = {
  destroy: `${CANCEL_CLOSE}|deletion|removal|get rid|borrado|baja|suppression|loschung|exclusao|eliminazione|verwijdering`,
  money: "payment|purchase|subscription|donation|withdrawal|refund|pago|compra|suscripcion|paiement|achat|abonnement|zahlung|kauf|pagamento|assinatura|acquisto|abbonamento|betaling|aankoop|abonnement|支払い|お支払い|購入|付款|支付|购买",
  session: "account access|sesion|session|sitzung|sessao|sessione|sessie",
  secret: "card number|full number|cvc|cvv|security code|password|pin|api key|secret|token|numero de tarjeta|numero de carte|kartennummer|numero do cartao|numero di carta|kaartnummer|カード番号|セキュリティコード|パスワード|暗証番号|卡号|安全码|密码|密碼",
};
const ASKED_ENTRIES: { commit: CommitClass; entry: Entry }[] = [
  ...COMMIT_ENTRIES.filter(({ commit }) => ASKED_CLASSES.includes(commit)).map(({ commit, entry }) => ({ commit, entry })),
  ...ASKED_CLASSES.flatMap((commit) => entries(ASKED_TOO[commit] ?? "").map((entry) => ({ commit, entry }))),
];

/**
 * Whether the visitor's words hold a word of this class: "delete" for
 * destroy, "pay" for money. A question is free text, so a verb counts in any
 * form that starts like it ("deleting", "cancellation"), when it has five
 * letters or more.
 */
export function classAsked(commit: CommitClass, words: string): boolean {
  const folded = fold(words);
  const text = { words: wordsOf(folded), cjk: cjkOf(folded) };
  const like = (word: string, wanted: string) => word === wanted || (wanted.length >= 5 && word.startsWith(wanted.slice(0, -1)));
  // The words of a phrase in order, with at most one small word between two of them: "sign me in", "log me out".
  const holdsLoosely = (entry: Entry) => {
    if (entry.cjk) return text.cjk.includes(entry.cjk);
    outer: for (let at = 0; at < text.words.length; at++) {
      let next = at;
      for (let index = 0; index < entry.words.length; index++) {
        if (index > 0 && next < text.words.length && !like(text.words[next]!, entry.words[index]!) && STOP_WORDS.has(text.words[next]!)) next++;
        if (next >= text.words.length || !like(text.words[next]!, entry.words[index]!)) continue outer;
        next++;
      }
      return true;
    }
    return false;
  };
  if (commit === "secret" && SHOW_ENTRIES.some(holdsLoosely) && SECRET_NOUN_ENTRIES.some(holdsLoosely)) return true;
  return ASKED_ENTRIES.some((asked) => asked.commit === commit && asked.entry.words.length + asked.entry.cjk.length > 0 && holdsLoosely(asked.entry));
}

// Fields --------------------------------------------------------------------

/** What fields Haptic never types into or reads are called, in every shipped language. */
const SECRET_FIELDS = entries(
  "password|passwort|passcode|contrasena|mot de passe|senha|palavra passe|wachtwoord|password attuale|pin|pin code|card number|credit card|debit card|card no|cvc|cvv|cvv2|csc|cid|security code|expiry|expiration|exp date|expiry date|mm yy|iban|bic|swift|routing number|account number|sort code|ssn|social security|tax id|national id|passport number|one time code|one time password|otp|verification code|confirmation code|2fa|two factor|authentication code|auth code|access code|secret|client secret|api key|apikey|access key|secret key|private key|license key|licence key|token|access token|" +
    "numero de tarjeta|tarjeta de credito|codigo de seguridad|fecha de caducidad|fecha de vencimiento|numero de cuenta|clave|codigo de verificacion|" +
    "numero de carte|carte bancaire|cryptogramme|code de securite|date d expiration|numero de compte|code de verification|cle|" +
    "kartennummer|kreditkarte|prufnummer|sicherheitscode|ablaufdatum|gultig bis|kontonummer|bestatigungscode|schlussel|geheimzahl|" +
    "numero do cartao|cartao de credito|codigo de seguranca|validade|numero da conta|codigo de verificacao|chave|" +
    "numero di carta|carta di credito|codice di sicurezza|scadenza|numero di conto|codice di verifica|chiave|" +
    "kaartnummer|creditcard|beveiligingscode|vervaldatum|rekeningnummer|verificatiecode|sleutel|" +
    "パスワード|カード番号|セキュリティコード|有効期限|口座番号|認証コード|確認コード|暗証番号|シークレット|トークン|apiキー|" +
    "密码|密碼|卡号|卡號|信用卡|安全码|有效期|账号|帳號|验证码|驗證碼|密钥|令牌",
);

/** "Type DELETE to confirm", in every shipped language: a verb for typing, and the words for confirming. */
const TYPE_TO_CONFIRM = [
  /\b(type|enter|write|escrib\w*|teclea\w*|introduc\w*|tape[zr]?|saisi\w*|entre[zr]|gib|geben|tippe\w*|eingeben|digit\w*|insira|scriv\w*|inserisci|typ\w*|voer)\b[^.]{0,80}\b(confirm\w*|confirmar|confirmer|bestatig\w*|confermare|conferma|bevestig\w*)\b/u,
  /\b(to confirm|para confirmar|pour confirmer|zur bestatigung|per confermare|om te bevestigen)\b[^.]{0,80}\b(type|enter|write|escrib\w*|tape[zr]?|saisi\w*|gib|geben|tippe\w*|digit\w*|scriv\w*|typ\w*)\b/u,
  /(入力|输入|輸入|入力して).{0,30}(確認|确认|確定)|(確認|确认).{0,30}(入力|输入|輸入)/u,
];

/**
 * A field Haptic never types into or reads (rule 2), by the words that
 * describe it: its label, name, placeholder and autocomplete. Passwords,
 * payment details, account numbers, one-time codes, secrets, keys and tokens,
 * and "type DELETE to confirm".
 */
export function isSecretField(describedAs: string): boolean {
  const folded = fold(describedAs.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_]/g, " "));
  if (/\b(current-password|new-password|one-time-code|cc-[a-z-]+)\b/.test(folded)) return true;
  const text = { words: wordsOf(folded), cjk: cjkOf(folded) };
  if (SECRET_FIELDS.some((entry) => holds(text, entry))) return true;
  return isTypeToConfirm(describedAs);
}

/** Whether a field's words ask the visitor to type something to confirm: "Type DELETE to confirm". */
export function isTypeToConfirm(describedAs: string): boolean {
  const folded = fold(describedAs);
  return TYPE_TO_CONFIRM.some((pattern) => pattern.test(folded));
}

const SEARCH_ENTRIES = entries("search|find|filter|query|lookup|look up|buscar|busqueda|busca|filtrar|rechercher|recherche|chercher|filtrer|suche|suchen|finden|filtern|pesquisar|pesquisa|procurar|cerca|cercare|ricerca|filtra|zoeken|zoek|vinden|検索|絞り込み|搜索|查找|筛选|過濾|搜尋");

/** Whether a field's words call it a search, filter or find box, in any shipped language. */
export function isSearchName(describedAs: string): boolean {
  const folded = fold(describedAs);
  const text = { words: wordsOf(folded), cjk: cjkOf(folded) };
  return SEARCH_ENTRIES.some((entry) => holds(text, entry));
}

// Grounding -----------------------------------------------------------------

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
/** A number as people write it: "1,500", "1.500,00", "$500", "12 000", "4.5". */
const NUMBER = /\d{1,3}(?:[,.'\u00a0\u202f ]\d{3})+(?:[.,]\d{1,2})?(?!\d)|\d+(?:[.,]\d+)?/g;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A number's digits with grouping marks gone and ",00" or ".00" dropped:
 * "$1,500.00", "1.500" and "1500" are all "1500". A mark followed by one or
 * two digits at the end, or by four or more, is a decimal mark; one followed
 * by three is a thousands mark.
 */
function numberKey(written: string): string {
  const decimal = /[.,](\d{1,2}|\d{4,})$/.exec(written);
  const whole = (decimal ? written.slice(0, decimal.index) : written).replace(/\D/g, "");
  const fraction = (decimal?.[1] ?? "").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/** The numbers in a text. Digits set apart by a plain space are read both as one number and as each part: "1 500" in French, "3 500" as two. */
function numbersIn(text: string): string[] {
  return (text.match(NUMBER) ?? []).flatMap((written) => [numberKey(written), ...(written.includes(" ") ? written.split(" ").map(numberKey) : [])]);
}

/** Two words are the same word when they are equal, or one starts the other and both have four letters or more ("Monthly" and "month"). */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  return a.startsWith(b) || b.startsWith(a);
}

/** Month names, and the short forms that are not also common words ("ago", "out", "set" are left out). */
const MONTHS: string[][] = [
  "january|jan|enero|janvier|janv|januar|janeiro|gennaio|januari",
  "february|feb|febrero|fevrier|februar|fevereiro|febbraio|februari",
  "march|marzo|mars|marz|marco|maart",
  "april|apr|abril|avril|aprile",
  "may|mayo|mai|maio|maggio|mei",
  "june|jun|junio|juin|juni|junho|giugno",
  "july|jul|julio|juillet|juli|julho|luglio",
  "august|aug|agosto|aout|augustus",
  "september|sep|sept|septiembre|septembre|setembro|settembre",
  "october|oct|octubre|octobre|oktober|okt|outubro|ottobre",
  "november|nov|noviembre|novembre|novembro",
  "december|dec|diciembre|decembre|dezember|dezembro|dicembre",
].map((names) => names.split("|"));
/** Words that name a day without its number: today, tomorrow, a weekday, the end of the month. */
const RELATIVE_DAYS = entries(
  "today|tomorrow|tonight|next week|next month|end of the month|end of month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|" +
    "hoy|manana|proxima semana|fin de mes|lunes|martes|miercoles|jueves|viernes|sabado|domingo|" +
    "aujourd hui|demain|semaine prochaine|fin du mois|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|" +
    "heute|morgen|nachste woche|monatsende|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|" +
    "hoje|amanha|proxima semana|fim do mes|segunda|terca|quarta|quinta|sexta|" +
    "oggi|domani|prossima settimana|fine mese|lunedi|martedi|mercoledi|giovedi|venerdi|sabato|" +
    "vandaag|morgen|volgende week|eind van de maand|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|" +
    "今日|明日|来週|月末|月曜|火曜|水曜|木曜|金曜|土曜|日曜|今天|明天|下周|月底|星期|周一|周二|周三|周四|周五|周六|周日",
);

/** Whether the visitor's words hold the date `iso` (YYYY-MM-DD): in figures in either order, by the month's name and day, or by a word like "tomorrow". */
function dateGrounded(iso: RegExpExecArray, folded: string): boolean {
  const [, year, month, day] = iso.map(Number) as [number, number, number, number];
  if (folded.includes(iso[0])) return true;
  for (const match of folded.matchAll(/(?<!\d)(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?(?!\d)/g)) {
    const a = Number(match[1]);
    const b = Number(match[2]);
    const y = match[3] ? Number(match[3].length === 2 ? `20${match[3]}` : match[3]) : year;
    if (y === year && ((a === day && b === month) || (a === month && b === day))) return true;
  }
  for (const match of folded.matchAll(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/g)) if (Number(match[1]) === month && Number(match[2]) === day) return true;
  const words = wordsOf(folded);
  for (let at = 0; at < words.length; at++) {
    const named = MONTHS.findIndex((names) => names.includes(words[at]!));
    if (named < 0 || (words[at] === "may" && !/\d/.test(`${words[at - 1] ?? ""}${words[at + 1] ?? ""}${words[at + 2] ?? ""}`))) continue;
    if (named + 1 !== month) continue;
    const near = [words[at - 1], words[at - 2], words[at + 1], words[at + 2]].map((word) => /^(\d{1,2})(?:st|nd|rd|th|er|e|o|a)?$/.exec(word ?? "")?.[1]).filter(Boolean).map(Number);
    if (!near.length || near.includes(day)) return true;
  }
  const text = { words, cjk: cjkOf(folded) };
  return RELATIVE_DAYS.some((entry) => holds(text, entry));
}

/**
 * Whether a text names one day of the calendar: "2026-11-20", "20/11/2026",
 * or a month's name beside a day's number, as a calendar names its days for
 * screen readers ("Friday, November 20th, 2026").
 */
export function namesADay(text: string): boolean {
  const folded = fold(text);
  if (/(?<!\d)\d{4}-\d{1,2}-\d{1,2}(?!\d)/.test(folded)) return true;
  if (/(?<!\d)\d{1,2}[/.-]\d{1,2}[/.-](?:\d{2}|\d{4})(?!\d)/.test(folded)) return true;
  const words = wordsOf(folded);
  const isDay = (word: string | undefined) => /^\d{1,2}(?:st|nd|rd|th|er|e|o|a)?$/.test(word ?? "");
  return words.some((word, at) => MONTHS.some((names) => names.includes(word)) && (isDay(words[at - 1]) || isDay(words[at + 1])));
}

/**
 * Whether `value` is in the visitor's own `words` (DESIGN 4.4).
 * - Emails compare whole.
 * - An ISO date (YYYY-MM-DD) is grounded by the same date in figures, by its
 *   month's name (with its day when one is written beside it), or by a word
 *   such as "tomorrow" or a weekday. The engine grounds a date in this form
 *   before writing it in a field's own pattern.
 * - Numbers compare by their digits: "$1,500" grounds "1500".
 * - Every other significant word must be there: the same, or one starting
 *   the other when both have four letters or more. Small words of every
 *   language are not counted: "Per month" is grounded by "a month".
 * - Japanese and Chinese must appear as written.
 * A value with nothing significant in it is grounded only when it appears whole.
 */
export function grounded(value: string, words: string): boolean {
  const said = fold(words);
  let rest = fold(value).trim();
  if (!rest) return false;
  const iso = ISO_DATE.exec(rest);
  if (iso) return dateGrounded(iso, said);
  const emails = rest.match(EMAIL) ?? [];
  const saidEmails = new Set(said.match(EMAIL) ?? []);
  if (emails.some((email) => !saidEmails.has(email))) return false;
  rest = rest.replace(EMAIL, " ");
  const saidWithoutEmails = said.replace(EMAIL, " ");
  const numbers = numbersIn(rest);
  const saidNumbers = new Set(numbersIn(saidWithoutEmails));
  if (numbers.some((number) => !saidNumbers.has(number))) return false;
  rest = rest.replace(NUMBER, " ");
  const saidWords = wordsOf(saidWithoutEmails.replace(NUMBER, " "));
  const significant = wordsOf(rest).filter((word) => !STOP_WORDS.has(word));
  if (significant.some((word) => !saidWords.some((other) => sameWord(word, other)))) return false;
  const runs = rest.match(CJK_RUN) ?? [];
  const saidCjk = cjkOf(said);
  if (runs.some((run) => !saidCjk.includes(run))) return false;
  if (emails.length || numbers.length || significant.length || runs.length) return true;
  // Only small words: grounded only when the visitor wrote exactly that.
  const plain = (text: string) => ` ${wordsOf(text).join(" ")} `;
  return plain(said).includes(plain(fold(value)));
}

/**
 * Which of `choices` a value names, as the engine finds an option (DESIGN 3.4):
 * an exact match wins; else the one that starts with the value; else the one
 * that holds every significant word of it. Two at the same level: "ambiguous",
 * and the visitor picks. None: -1.
 */
export function pickChoice(value: string, choices: readonly string[]): number | "ambiguous" {
  const wanted = fold(value).replace(/\s+/g, " ").trim();
  if (!wanted) return -1;
  const folded = choices.map((choice) => fold(choice).replace(/\s+/g, " ").trim());
  const only = (test: (choice: string) => boolean): number | "ambiguous" | undefined => {
    const found = folded.flatMap((choice, index) => (choice && test(choice) ? [index] : []));
    if (found.length === 1) return found[0];
    return found.length > 1 ? "ambiguous" : undefined;
  };
  const wantedWords = wordsOf(wanted).filter((word) => !STOP_WORDS.has(word));
  return (
    only((choice) => choice === wanted) ??
    only((choice) => choice.startsWith(wanted)) ??
    (wantedWords.length ? only((choice) => wantedWords.every((word) => wordsOf(choice).some((other) => sameWord(word, other)))) : undefined) ??
    -1
  );
}

/** A date written in the form a field shows ("MM-DD-YYYY" gives "12-01-2026" for 2026-12-01), or undefined when no form is shown. */
export function dateLike(form: string, date: { year: number; month: number; day: number }): string | undefined {
  const match = /\b(d{1,2}|m{1,2}|y{2,4})([-/. ])(d{1,2}|m{1,2}|y{2,4})\2(d{1,2}|m{1,2}|y{2,4})\b/i.exec(form);
  if (!match) return undefined;
  const parts = [match[1]!, match[3]!, match[4]!].map((part) => part.toLowerCase());
  if (new Set(parts.map((part) => part[0])).size !== 3) return undefined;
  const write = (part: string) => {
    if (part[0] === "y") return part.length === 2 ? String(date.year).slice(2) : String(date.year);
    const number = part[0] === "m" ? date.month : date.day;
    return part.length === 2 ? String(number).padStart(2, "0") : String(number);
  };
  return parts.map(write).join(match[2]);
}

// The check on a reply ------------------------------------------------------

/** A reply after the check, and why its `do` was removed when it was. */
export interface ActionCheck {
  reply: TurnReply;
  withheld?: Refusal;
}

const CLICKED = new Set(["link", "button", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "treeitem", "clickable", "checkbox", "radio", "switch", "combobox"]);
const TYPED = new Set(["textbox", "searchbox", "combobox", "spinbutton"]);
const TICKED = new Set(["checkbox", "switch", "menuitemcheckbox"]);
/** Pressed to pick from a list or to set a state, where the words are the page's choice and not a verb. */
const PICKED = new Set(["option", "menuitemradio", "treeitem", "radio", "checkbox", "switch", "menuitemcheckbox"]);

/** Whether a listed control says it opens a list or a menu. */
function opensSomething(element: SnapElement): boolean {
  return (element.state ?? []).some((state) => state === "expanded" || state === "collapsed" || state.startsWith("opens "));
}

/** Whether a listed field is a search box: by its role, its words, or the search landmark it sits in. */
function isSearchBox(element: SnapElement): boolean {
  return element.role === "searchbox" || isSearchName(element.label) || /^search\b/.test(element.context ?? "");
}

/**
 * Controls that are picked, where "choose" means what a click means. A model
 * that asks to choose the radio "For someone else", or the option "Per month"
 * of a list that is open, asks for the press that picks it.
 */
const PICKED_BY_PRESS = new Set(["radio", "menuitemradio", "option", "treeitem"]);

/**
 * The act Haptic does for `act` on this control, or undefined when the act
 * does not fit it. Acts that mean the same thing on a control are done as
 * the one the engine knows for it: on a radio, a menu radio, an option or a
 * tree item, "choose" is a click. A radio is still never cleared, and a value
 * that came with "choose" is dropped with it: what is picked is the control
 * itself, judged by its own words.
 */
export function actFor(act: string, element: SnapElement): Act | undefined {
  if (act === "choose" && PICKED_BY_PRESS.has(element.role)) return "click";
  return fits(act, element) ? (act as Act) : undefined;
}

/** Whether the act fits what the control is. */
function fits(act: string, element: SnapElement): boolean {
  switch (act) {
    case "click":
      return CLICKED.has(element.role);
    case "type":
      return TYPED.has(element.role);
    case "choose":
      return element.role === "select" || element.role === "combobox" || (["button", "clickable"].includes(element.role) && (element.state ?? []).includes("opens a list"));
    case "check":
      return TICKED.has(element.role) || element.role === "radio" || element.role === "menuitemradio";
    case "uncheck":
      return TICKED.has(element.role);
    case "press_enter":
      return TYPED.has(element.role) && isSearchBox(element);
    default:
      return false;
  }
}

/**
 * The check every act reply passes, on the server after the model answers and
 * again in the widget before the gate. It judges by the listed control only
 * (role, label, icon, link), never by the live page, so it can only remove a
 * `do`, never add one. The reply returned is a copy:
 * - `do` that is not one of `ACTS`, or with no target listed: removed.
 * - `do` with `commits: true`: `do` and `enter` removed, `commits` kept: the hand-over. Withheld "contradiction".
 * - `do` that means the same as the act that fits the control (`actFor`):
 *   replaced by it, so "choose" on a radio or an option is a click.
 * - `do` that does not fit the control's role, or on a disabled control: removed, "unfit".
 * - `do` on a control whose words commit (link or not, `readName`): removed, "words" (or "marked").
 * - `do` on a link to another site: removed, "leaves".
 * - `type` or `choose` on a field `isSecretField` names: removed, "secret".
 * - `type` whose `enter` is not grounded in the goal, or `choose` whose `enter`
 *   and the listed option it matches are not: removed, "ungrounded".
 * - `type` longer than the whole request may type: removed, "cap".
 * - `press_enter` outside a field named as a search: removed, "enter".
 * - `enter` with no `type` or `choose` left to use it: set to null.
 * When a `do` is removed, `withheld` is set on the reply too, and `removed`
 * says which act it was: names from Haptic's own list, never anything from
 * the page, so the server can log them.
 */
export function checkAction(reply: TurnReply, request: Pick<TurnRequest, "goal" | "snapshot">, acting: { commitWords?: readonly string[] } = {}): ActionCheck {
  const out: TurnReply = { ...reply };
  const asked = reply.do;
  const keep = (): ActionCheck => {
    if (out.do !== "type" && out.do !== "choose" && out.enter !== undefined) out.enter = null;
    return { reply: out };
  };
  const withhold = (why: Refusal): ActionCheck => {
    out.do = null;
    out.enter = null;
    out.withheld = why;
    if ((ACTS as readonly string[]).includes(asked ?? "")) out.removed = asked as Act;
    return { reply: out, withheld: why };
  };
  // A reply whose `do` is already gone keeps the server's reason, so the widget still speaks for that step itself.
  if (asked === undefined || asked === null) return keep();
  if (!(ACTS as readonly string[]).includes(asked)) return withhold("unfit");
  const element = request.snapshot.elements.find((listed) => listed.id === reply.target);
  if (!element) return withhold("changed");
  if (reply.commits === true) return withhold("contradiction");
  const act = actFor(asked, element);
  if (!act || (element.state ?? []).includes("disabled")) return withhold(asked === "press_enter" ? "enter" : "unfit");
  out.do = act;
  if (act === "click" && element.href?.startsWith("external:")) return withhold("leaves");

  if (act === "type" || act === "choose" || act === "press_enter") {
    if (isSecretField(element.label)) return withhold("secret");
  }
  if (act === "click" && !PICKED.has(element.role)) {
    // An icon names a control only when it has no words of its own: a dialog's "Close" with an X icon is not "Close x".
    const name = element.label || element.icon || "";
    const verdict = readName(name, { link: element.role === "link", dialog: !!request.snapshot.dialog, opener: opensSomething(element), extra: acting.commitWords });
    if (verdict.commit) return withhold(verdict.marked ? "marked" : "words");
  }
  if (act === "click" && PICKED.has(element.role) && ["option", "menuitemradio", "treeitem"].includes(element.role)) {
    // An option is the page's own choice. It stops only on words that would stop a link: "Delete", "Sign out".
    const verdict = readName(element.label || element.icon || "", { link: true, extra: acting.commitWords });
    if (verdict.commit) return withhold(verdict.marked ? "marked" : "words");
  }

  const value = typeof reply.enter === "string" ? reply.enter.trim() : "";
  if (act === "type") {
    if (!value) return withhold("ungrounded");
    if (value.length > ACTING_LIMITS.typedChars) return withhold("cap");
    if (!grounded(value, request.goal)) return withhold("ungrounded");
  }
  if (act === "choose") {
    if (!value) return withhold("ungrounded");
    if (!grounded(value, request.goal)) {
      const options = element.options ?? [];
      const index = pickChoice(value, options);
      if (typeof index !== "number" || index < 0 || !grounded(options[index]!, request.goal)) return withhold("ungrounded");
    }
  }
  delete out.withheld;
  delete out.removed;
  return keep();
}
