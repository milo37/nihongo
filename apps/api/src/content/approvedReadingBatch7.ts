import {
  adminQuestionContentInputSchema,
  validateQuestionImportRequestSchema
} from '@nihongo/contracts/admin/content-operations'

// JLP-266 internal QA; registration and release remain unverified.
export const approvedReadingBatch7 = {
  items: [
    {
      draftId: 'JLP-265-n4-reading-09-draft1',
      sha256:
        '31d5701993366c30b9f3129b55b57e2d2ac1d3ce70041c91afa752e972d06fd3',
      registration: {
        id: 'n4-reading-09',
        level: 'N4',
        subject: 'READING',
        questionType: 'SHORT_READING',
        questionText: '田中さんは、かさを どこで 受け取りますか。',
        options: [
          '自分の 机の 横',
          '佐藤さんの 家',
          '受付',
          '二本の かさが ある 店'
        ],
        correctIndex: 2,
        explanationKo:
          '어제는 책상 옆에 두었지만 오늘 같은 색 우산이 또 있어 빌린 우산을 접수처 직원에게 맡겼습니다. 마지막 안내에 따라 접수처에서 이름을 말하고 받으면 됩니다. 어제 위치를 현재 수령 장소로 선택하면 안 됩니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['전달 메모', '보관 장소 변경', '우산'],
        passage:
          '田中さんへ。借りていた かさを、きのう あなたの 机の 横に 置きました。名前が 書いてある 青い かさです。今朝、同じ 色の かさが もう 一本 あったので、どちらか 分からなくなると 思って、借りていた かさを 受付の 人に 渡しました。帰るとき、受付で 名前を 言って 受け取ってください。佐藤'
      }
    },
    {
      draftId: 'JLP-265-n4-reading-10-draft1',
      sha256:
        '8ddb1761e3964cca348af6c34dd110c3f0ad0d388103dedf8a8097e5ed913538',
      registration: {
        id: 'n4-reading-10',
        level: 'N4',
        subject: 'READING',
        questionType: 'SHORT_READING',
        questionText: 'この 人は、なぜ 今回 服を 持っていきませんか。',
        options: [
          '出すつもりの シャツに 穴が あり、ほかの 服は 自分で 着るから',
          '土曜日には 服を 集めていないから',
          'シャツが 大きすぎて、持っていけないから',
          '穴の ある 服だけを 集めているから'
        ],
        correctIndex: 0,
        explanationKo:
          '내려던 셔츠는 구멍이 있어 수거 대상이 아니고 다른 옷은 본인이 계속 입기 때문에 이번에는 아무것도 가져가지 않습니다. 셔츠가 작아진 사실은 최초 기부 생각의 배경이며, 실제로 가져가지 않는 이유는 수거 조건과 다른 옷의 사용 상태입니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['옷 수거', '참여 조건', '두 이유 결합'],
        passage:
          'わたしの 町では、土曜日に 古い 服を 集めています。まだ 着られる 服は、必要な 人に 渡すそうです。わたしは 小さくなった シャツを 持っていこうと 思いましたが、よく 見ると 袖に 穴が ありました。穴の ある 服は 集めないので、この シャツは 家で 掃除に 使うことに しました。ほかの 服は まだ 自分で 着るので、今回は 何も 持っていきません。'
      }
    },
    {
      draftId: 'JLP-265-n4-reading-11-draft1',
      sha256:
        'dda0f192724ae7e356d75abda307f1e5936cbd8668134984b1cad569bc6017c7',
      registration: {
        id: 'n4-reading-11',
        level: 'N4',
        subject: 'READING',
        questionType: 'SHORT_READING',
        questionText: '今回は、母は どうやって 病院へ 行きますか。',
        options: [
          '火曜日の 朝、バスで 行きます',
          '月曜日に、病院の 車で 行きます',
          '火曜日の 午後、歩いて 行きます',
          '火曜日の 午後、子どもに 車で 送ってもらいます'
        ],
        correctIndex: 3,
        explanationKo:
          '화요일 예약 시각이 오전 9시에서 오후 3시로 바뀌었습니다. 화자는 오후에 쉬므로 평소 어머니가 부탁하는 차량 이동이 가능해졌고 이번에는 버스를 쓰지 않아도 됩니다. 월요일은 전화가 온 날이며 진료 날짜가 바뀌었다는 내용은 없습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['예약 변경', '이동 수단', '조건 변화'],
        passage:
          '母は 病院へ 行く 日、いつも わたしに 車で 送ってほしいと 言います。今週の 火曜日も 朝九時に 病院へ 行く予定でしたが、わたしは その 時間に 仕事が ありました。母は バスで 行くと 言っていました。ところが、月曜日に 病院から 電話が 来て、予約が 午後三時に 変わりました。午後なら わたしは 休みなので、今回は バスを 使わずに 済みます。'
      }
    },
    {
      draftId: 'JLP-265-n4-reading-12-draft1',
      sha256:
        'ef0fff025704e6ca435e0d71065034c25b99afeef839209fd7b23ec35fa14635',
      registration: {
        id: 'n4-reading-12',
        level: 'N4',
        subject: 'READING',
        questionType: 'INFO_RETRIEVAL',
        questionText: '初めて 参加する 山本さんは、どうすれば いいですか。',
        options: [
          '当日の 朝、電話で 申し込み、エプロンを 持っていきます',
          '前の 日の 午後五時までに、ホームページで 申し込み、エプロンを 持っていきます',
          '前の 日の 午後五時までに、電話で 申し込み、道具を 全部 持っていきます',
          '当日の 朝、ホームページで 申し込み、エプロンを 借ります'
        ],
        correctIndex: 1,
        explanationKo:
          '첫 참가자는 홈페이지로 신청해야 하고 마감은 전날 오후 5시입니다. 도구는 빌릴 수 있지만 앞치마는 직접 가져와야 합니다. 세 조건을 모두 충족하는 보기1이 정답입니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['신청 안내', '참가 이력', '마감 준비물'],
        passage:
          '料理教室の 申し込み\n初めて 参加する 人：ホームページで 名前と 電話番号を 入れて 申し込んでください。\n前に 参加したことが ある 人：電話でも 申し込めます。\n道具は 教室で 貸しますが、エプロンは 自分で 持ってきてください。\n申し込みは 前の 日の 午後五時までです。当日の 申し込みは できません。'
      }
    },
    {
      draftId: 'JLP-265-n4-reading-13-draft1',
      sha256:
        'f3d28a2698574a4c1532c44a16a00f727d3483cc95cb5a9fd61b0641c883d845',
      registration: {
        id: 'n4-reading-13',
        level: 'N4',
        subject: 'READING',
        questionType: 'INFO_RETRIEVAL',
        questionText:
          '鈴木さんは 一日の 利用で、月曜日の 午後八時に 自転車を 置き、火曜日の 午前七時に 出します。料金と 利用について 正しい ものは どれですか。',
        options: [
          '150円で、午前七時に 出せます',
          '300円ですが、午前七時には 門が 閉まっています',
          '2,400円で、午前七時に 出せます',
          '300円で、午前七時に 出せます'
        ],
        correctIndex: 3,
        explanationKo:
          '일일 이용은 날짜가 바뀌면 150엔이 추가되어 월요일부터 화요일까지 합계 300엔입니다. 출입 가능 시간은 오전 6시부터이므로 오전 7시에는 자전거를 꺼낼 수 있습니다. 24시간 요금이 아니라 날짜 변경 기준임을 확인해야 합니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['자전거 보관', '날짜 기준 요금', '출입 시간'],
        passage:
          '駅の 自転車置き場\n一日の 利用：150円。日付が 変わると、さらに 150円 かかります。\n一か月の 利用：2,400円。月の 初めから 終わりまで 使えます。途中から 利用を 始めても、料金は 変わりません。\nどちらも 午前六時から 午後十一時まで 出し入れできます。それ以外の 時間は 門を 閉めます。'
      }
    }
  ],
  qaPass: 5,
  registered: 0,
  externalEducatorReview: false
} as const

// clientItemId is a logical content ID. Import returns newly allocated database IDs.
// Keep that returned mapping for subsequent review/publish and frontend parity.
export const createApprovedReadingBatch7Import = () =>
  validateQuestionImportRequestSchema.parse({
    items: approvedReadingBatch7.items.map(({ registration }) => ({
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
