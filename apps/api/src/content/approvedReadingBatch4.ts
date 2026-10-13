import {
  adminQuestionContentInputSchema,
  validateQuestionImportRequestSchema
} from '@nihongo/contracts/admin/phase7'

// JLP-219 internal review; this batch is separate from the immutable 65-question bootstrap.
export const approvedReadingBatch4 = {
  items: [
    {
      draftId: 'JLP-216-n2-reading-04-draft1',
      sha256:
        'a202d40cd796789b9cc15e96d001a12398a32143814506eb36365a54a23b9c2b',
      registration: {
        id: 'n2-reading-04',
        level: 'N2',
        subject: 'READING',
        questionType: 'MEDIUM_READING',
        passage:
          '古い建物を残すというと、建てられた当時の姿に戻すことだと考える人がいる。しかし、一つの建物にも長い時間の中でさまざまな変化が加えられている。どの時代の姿を本来の姿と呼ぶかは、簡単には決められない。\n私たちが修理を担当した町の集会所には、入口に古い階段があった。その横には、後から付けられた小さな坂道がある。調査すると、その坂道は、足をけがした住民も集会に参加できるよう、三十年前に町の人たちが作ったものだった。当初の図面にはないが、地域の生活を伝える大切な部分だ。\n一方、屋根の傷んだ木材は安全のため取り替える必要があった。古いという理由だけで何も変えなければ、建物を使い続けることが難しくなる。私たちは取り外した木材の写真と寸法を記録し、どこをどう直したかも分かるようにした。\n残すべきものを判断するには、最初の姿だけでなく、その後に積み重なった人々の使い方にも目を向ける必要がある。同時に、使い続けるための変更を、歴史を消す行為だと一律に考えるべきではない。',
        questionText:
          'この修理で、坂道を残したことと屋根の木材を替えたことは、どのような考えに基づいていますか。',
        options: [
          '最初の図面にある部分だけを残せば、建物の歴史を十分に伝えられるという考え',
          '後から加えられた部分はすべて残し、最初からある部分は取り替えるという考え',
          '安全よりも古い材料の保存を優先すべきだという考え',
          '使われ方の歴史を尊重しつつ、安全に使い続けるための変更も認めるという考え'
        ],
        correctIndex: 3,
        explanationKo:
          '나중에 만든 경사로도 주민의 이용 역사를 보여 주므로 남겼고, 손상된 지붕 목재는 계속 안전하게 쓰기 위해 기록을 남기고 교체했습니다. 이는 최초 모습만을 기준으로 하지 않으며, 역사 존중과 사용에 필요한 변경을 함께 인정하는 판단입니다. 나중 부분은 모두 남기고 최초 부분은 모두 교체한다는 일률적 규칙이나 안전보다 낡은 재료를 우선한다는 원칙은 제시하지 않습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['중문 독해', '사례 종합', '역사와 지속 이용']
      }
    },
    {
      draftId: 'JLP-216-n2-reading-05-draft1',
      sha256:
        '224d1dc2a114f43bc3eba341b44e7ece64ed2a7bd92187b2f122c955ae3c088d',
      registration: {
        id: 'n2-reading-05',
        level: 'N2',
        subject: 'READING',
        questionType: 'MEDIUM_READING',
        passage:
          'ある店が、ウェブサイトに商品の感想を書く欄を設けた。書き込みには高い評価が多かったので、店長は、ほとんどの客が満足していると考えた。ところが、購入者全員に短い質問票を送ると、使い方が分かりにくいという回答が予想以上に集まった。\n二つの結果が違うからといって、先の感想がうそだったとは限らない。自分から感想を書こうと思う人と、店から質問されたときに答える人とでは、経験や気持ちが異なる可能性がある。強く感動した人は文章を書いても、多少困っただけの人は、わざわざ書き込みをしないかもしれない。\nもちろん、質問票を送ればすべての購入者の意見が分かるわけでもない。回答しなかった人がどれほどいるか、その人たちがどのような客なのかも確かめる必要がある。質問の仕方によって、答えやすい内容が変わることも考えられる。\n店長は、書き込みを消すのではなく、質問票の結果と並べて読むことにした。意見の数や平均だけを見るよりも、どのような方法で、誰の声が集まったのかを理解した上で判断したいからだ。',
        questionText: '筆者の考えに合う判断の仕方はどれですか。',
        options: [
          '結果の違いから、ウェブサイトの感想はすべて信用できないと判断する。',
          'それぞれの集め方と回答者の違いを考慮し、複数の結果を読む。',
          '購入者全員に質問票を送ったので、無回答者の意見も分かったと判断する。',
          '最も件数が多い結果だけを使えば、集め方を調べる必要はないと判断する。'
        ],
        correctIndex: 1,
        explanationKo:
          '자발적으로 쓴 감상과 질문지를 받아 답한 의견은 참여자와 수집 방식이 다를 수 있습니다. 질문지를 전원에게 보냈더라도 미응답자의 의견까지 알 수 있는 것은 아닙니다. 따라서 각 방법과 응답자 차이를 고려해 결과를 함께 읽는 선택이 맞습니다. 글은 온라인 감상을 전부 거짓으로 처리하지 않고, 가장 많은 결과 하나만 택하거나 수집 방식을 무시하지도 않습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['중문 독해', '조사 해석', '판단 근거']
      }
    },
    {
      draftId: 'JLP-216-n2-reading-06-draft1',
      sha256:
        'e1c66cf7f08677cbe2beacbdd05a70dddcc8551d4f6343d072069d69fdd4fe0e',
      registration: {
        id: 'n2-reading-06',
        level: 'N2',
        subject: 'READING',
        questionType: 'MEDIUM_READING',
        passage:
          '駅前の修理店は、以前、来店した順に客の品物を受け取っていた。待ち時間が長いという声が増えたため、店主は予約制を試してみることにした。予約した人は決められた時間に来ればよく、店も必要な部品を準備しやすくなった。\nしかし、すべての受付を予約だけにすると、急にかばんの持ち手が壊れた人など、その日に相談したい客が困ってしまう。一方、予約なしの客をいつでも先に受け入れれば、予約した人との約束が守れなくなる。どちらか一方を無条件に優先する方法では、問題が残る。\nそこで店主は、一日の作業時間の一部を当日の相談用に残した。ただし、その場で修理が終わるとは約束しない。品物の状態を見て、部品があるか、どのくらい時間がかかるかを説明し、客が待つか別の日にするか選べるようにした。予約した人の作業時間は、この相談とは分けて確保している。\n予約制は客を二種類に分けて、一方を大切にするためのものではない。予測できる仕事と突然の相談を区別し、それぞれに対応できる余地を作ることで、無理な約束を減らすための工夫なのだ。',
        questionText:
          '店主が当日の相談時間を設けた目的として、最も適切なものはどれですか。',
        options: [
          '予約した客の修理を中断し、急な客を必ず先に修理するため',
          '予約なしの客にも、その日のうちに修理が終わると約束するため',
          '予約の作業時間を守りながら、急な相談にも条件を説明して対応するため',
          '予約した客と予約しない客の両方を、来店順だけで受け付けるため'
        ],
        correctIndex: 2,
        explanationKo:
          '당일 상담 시간을 따로 남기면서 예약된 작업 시간은 별도로 확보합니다. 당일 완료를 약속하는 대신 부품과 소요 시간 등을 설명해 고객이 선택하게 합니다. 따라서 예약 약속을 지키면서 급한 상담에도 현실적인 조건을 알려 대응하려는 목적입니다. 급한 고객을 무조건 먼저 수리하거나 당일 완료를 보장하지 않으며, 예약 이전처럼 방문 순서만으로 운영하지도 않습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['중문 독해', '운영 조정', '상충 요구']
      }
    },
    {
      draftId: 'JLP-216-n2-reading-07-draft1',
      sha256:
        '5b25a9e9746678b34bb35d816668a2bb7f9e4ff0d0e97a033a53bb3ec053b9be',
      registration: {
        id: 'n2-reading-07',
        level: 'N2',
        subject: 'READING',
        questionType: 'INFO_RETRIEVAL',
        passage:
          '撮影機材レンタル・返却の案内\n通常の返却期限は最終利用日の午後6時です。返却は営業所の窓口で受け付けます。\n最終利用日の午後6時までにウェブサイトから延長申請をした場合は、翌日の正午まで返却期限を延ばせます。延長料金は1日分ですが、発送や配達は利用できません。\n返却時、同時に貸し出したケースと付属品も必要です。付属品を忘れた場合は、機材だけを預けても返却完了にはなりません。\n故障に気づいた場合は、返却予定日を待たずに電話で連絡してください。故障の連絡だけでは返却期限は変わりません。',
        questionText:
          '田中さんの最終利用日は月曜日です。月曜午後5時に延長申請を済ませました。機材に故障はなく、ケースと付属品もそろっています。案内に合う返却方法はどれですか。',
        options: [
          '火曜日の正午までに、機材・ケース・付属品を営業所の窓口へ持参する。',
          '火曜日の午後6時までに、機材・ケース・付属品を営業所の窓口へ持参する。',
          '火曜日の正午までに、機材だけを営業所へ発送する。',
          '月曜日に電話で連絡すれば、付属品は後日持参しても返却完了になる。'
        ],
        correctIndex: 0,
        explanationKo:
          '월요일 오후 5시의 연장 신청은 당일 오후 6시 이전이므로 다음 날 화요일 정오까지 연장할 수 있습니다. 연장 시에도 창구에 직접 반환해야 하고 케이스와 부속품을 함께 가져가야 합니다. 화요일 오후 6시는 연장 기한을 넘깁니다. 배송은 사용할 수 없고 장비만 맡겨도 반환 완료가 되지 않습니다. 전화 연락만으로 부속품 조건이나 기한이 바뀌지도 않습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['정보 찾기', '반환 연장', '복수 조건']
      }
    },
    {
      draftId: 'JLP-216-n2-reading-08-draft1',
      sha256:
        'de24855fced46281524a700c04556ef41c28116ebcc015853c0708ffaa96f28f',
      registration: {
        id: 'n2-reading-08',
        level: 'N2',
        subject: 'READING',
        questionType: 'INFO_RETRIEVAL',
        passage:
          '資料室・複写サービス\n受付時間は午前10時から午後4時までです。館内資料の複写だけを受け付け、持参した資料は複写しません。\n白黒複写は受付後にその場で渡します。カラー複写は翌開室日の午後1時以降に窓口で渡します。いずれも郵送は行いません。\n一人の一日の申込上限は、白黒とカラーを合わせて20枚です。同じ日の追加申込みも、この上限に含みます。\n水曜日は休室です。火曜日に申し込んだカラー複写の受取開始は木曜日の午後1時です。\n複写できない資料もあるため、申込前に窓口で確認してください。',
        questionText:
          '複写可能な館内資料について、火曜日の午前中に白黒8枚を申し込んだ人が、同じ日の午後3時に追加申込みをします。受取りを含め、案内に合うものはどれですか。',
        options: [
          'カラー15枚を追加し、木曜日の午後1時に受け取る。',
          'カラー12枚を追加し、水曜日の午後1時に受け取る。',
          'カラー12枚を追加し、木曜日の午後1時以降に窓口で受け取る。',
          'カラー12枚を追加し、火曜日の午後3時に窓口で受け取る。'
        ],
        correctIndex: 2,
        explanationKo:
          '이미 신청한 흑백 8장과 추가 컬러 12장을 합하면 하루 상한 20장입니다. 화요일 컬러 신청분은 수요일 휴실을 건너뛰어 목요일 오후 1시 이후 창구에서 받습니다. 15장을 추가하면 총 23장으로 상한을 넘깁니다. 수요일은 휴실이고, 컬러 복사본을 화요일 당일 받는 규칙도 없습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['정보 찾기', '누적 상한', '다음 개실일']
      }
    }
  ],
  qaPass: 5,
  registered: 0,
  externalEducatorReview: false
} as const

// clientItemId is a logical content ID. Import returns newly allocated database IDs.
// Keep that returned mapping for subsequent review/publish and frontend parity.
export const createApprovedReadingBatch4Import = () =>
  validateQuestionImportRequestSchema.parse({
    items: approvedReadingBatch4.items.map(({ registration }) => ({
      clientItemId: registration.id,
      content: adminQuestionContentInputSchema.parse({
        level: registration.level,
        subject: registration.subject,
        questionType: registration.questionType,
        difficulty: registration.difficulty,
        questionText: registration.questionText,
        passage: registration.passage,
        explanationKo: registration.explanationKo,
        explanationJa: registration.explanationJa,
        tagNames: registration.tags,
        options: registration.options.map((text, index) => ({
          clientOptionKey: `option-${index + 1}`,
          text
        })),
        correctOptionKey: `option-${registration.correctIndex + 1}`
      })
    }))
  })
