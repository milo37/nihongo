import {
  adminQuestionContentInputSchema,
  validateQuestionImportRequestSchema
} from '@nihongo/contracts/admin/phase7'

// JLP-215 internal review; this batch is separate from the immutable 65-question bootstrap.
export const approvedReadingBatch3 = {
  items: [
    {
      draftId: 'JLP-213-n3-reading-04-draft1',
      sha256:
        '78b3295ce720099915d319def9617481120bd1c397b69547f0dcf38ac5024101',
      registration: {
        id: 'n3-reading-04',
        level: 'N3',
        subject: 'READING',
        questionType: 'SHORT_READING',
        passage:
          '森さんへ。展示会で使う写真を送ってくださり、ありがとうございます。ただ、送られた写真は小さいので、大きく印刷すると、顔がはっきり見えなくなります。写真の内容を変える必要はありません。同じ写真の、もっと大きいデータを明日の昼までに送っていただけますか。難しい場合は、今日の夕方までにご連絡ください。佐々木',
        questionText:
          '森さんが大きいデータを送れない場合、どうすればよいですか。',
        options: [
          '明日の昼までに別の写真を送ります。',
          '今日の夕方までに佐々木さんに連絡します。',
          '今日の夕方までに写真を印刷します。',
          '明日の昼を過ぎてから連絡します。'
        ],
        correctIndex: 1,
        explanationKo:
          '요청한 큰 데이터를 보내기 어려운 경우에는 오늘 저녁까지 연락하라고 했습니다. 내일 낮까지는 큰 데이터를 보내는 기한이며, 연락 기한과 다릅니다. 사진 내용은 바꿀 필요가 없고, 모리 씨가 직접 인쇄하라는 요청도 없습니다. 내일 낮을 넘긴 뒤 연락하는 것은 오늘 저녁까지라는 기한을 지키지 못합니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['짧은 글', '업무 연락', '조건별 기한']
      }
    },
    {
      draftId: 'JLP-213-n3-reading-05-draft1',
      sha256:
        'd5357a1645a2a8028408a74ce8380b64232aac474a0dec63812c5b8e1dc68b77',
      registration: {
        id: 'n3-reading-05',
        level: 'N3',
        subject: 'READING',
        questionType: 'MEDIUM_READING',
        passage:
          '町の案内所で働き始めたころ、私は観光客に道を説明するとき、できるだけ詳しく話すようにしていた。駅から目的地までの店の名前や、道の幅まで説明すれば、迷わず行けると思っていたからだ。\nしかし、説明が終わると「結局、最初にどちらへ行けばいいですか」と聞かれることが多かった。相手はこの町を初めて訪れた人なので、私にとっては分かりやすい店の名前も、目印にならなかったのだ。\nそこで、まず目的地までの地図を見せ、曲がる場所を二つだけ伝えることにした。店の名前よりも、川や大きな橋など、見つけやすいものを目印にしている。説明のあとには、相手に最初の曲がり角を指してもらい、分かっているか確かめる。\n今は、詳しい説明を求められたときだけ、追加の情報を話す。情報を多く伝えることより、相手が実際に歩き始められることを大切にしたい。',
        questionText: '筆者は、道の説明で何を大切にするようになりましたか。',
        options: [
          '町の店の名前をすべて覚えてもらうこと',
          '相手が質問しないように長く説明すること',
          '相手が進む方向を理解し、歩き始められること',
          '地図を渡したら何も説明しないこと'
        ],
        correctIndex: 2,
        explanationKo:
          '처음에는 정보를 많이 주면 길을 찾기 쉽다고 생각했지만, 낯선 가게 이름은 관광객에게 표지가 되지 않았습니다. 이후 지도와 찾기 쉬운 표지를 사용하고 첫 모퉁이를 짚게 해 이해를 확인합니다. 마지막 문장에서도 실제로 걷기 시작할 수 있게 하는 것을 중요하게 여긴다고 합니다. 가게 이름을 모두 외우게 하거나 질문을 막는 것이 목적은 아니며, 지도만 건네고 설명을 생략하지도 않습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['중문 독해', '설명 방식', '주장 파악']
      }
    },
    {
      draftId: 'JLP-213-n3-reading-06-draft1',
      sha256:
        '2d6688ca48a0809299d60542c03550547c95cb9c749ca55de645f17e78dc2fd7',
      registration: {
        id: 'n3-reading-06',
        level: 'N3',
        subject: 'READING',
        questionType: 'MEDIUM_READING',
        passage:
          '地域の合唱グループでは、発表会の曲を選ぶとき、いつも経験の長い人たちが意見を出していた。新しく入った人に尋ねても、「皆さんにお任せします」と答えることが多い。私は、特に希望がないのだろうと思っていた。\nある日、練習の帰りに新人の一人が「歌ってみたい曲はあるのですが、皆さんがすぐ決めるので、途中で言いにくいんです」と話した。それを聞いて、希望がないのではなく、話す機会がない人もいるのだと気づいた。\n次の曲選びでは、話し合いの前に一人ずつ希望を書いてもらった。名前を書く必要はない。集まった曲を並べてから、歌いやすさや練習に必要な時間をみんなで考えた。希望を書いた人が自分の曲を必ず説明する、という決まりも作らなかった。\n結果として選ばれたのは、以前にも候補になった曲だった。それでも、「自分の希望も一度は考えてもらえた」と新人が言ってくれた。曲が変わらなくても、決め方を変えることには意味があると思った。',
        questionText:
          '筆者が「決め方を変えることには意味がある」と考えたのはなぜですか。',
        options: [
          '新人の希望も検討され、話し合いに参加できたと感じてもらえたから',
          '新人が出した曲を必ず選ぶことにしたから',
          '全員が同じ曲を希望していると分かったから',
          '経験の長い人が曲選びに参加しなくなったから'
        ],
        correctIndex: 0,
        explanationKo:
          '선택된 곡 자체는 전에 후보였던 곡이지만, 새 회원은 자기 희망도 한 번 검토됐다고 말했습니다. 글쓴이는 희망을 말할 기회를 늘린 결정 과정에 의미가 있다고 본 것입니다. 새 회원의 곡을 반드시 고르기로 했다는 규칙은 없고, 모두 같은 곡을 희망했다거나 오래 활동한 회원이 빠졌다는 내용도 없습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['중문 독해', '참여 과정', '결론 이유']
      }
    },
    {
      draftId: 'JLP-213-n3-reading-07-draft1',
      sha256:
        '6e774d632ffe3d6178f74a36c50b15b700c9e0a02442144b3f3cda7f4bdc5184',
      registration: {
        id: 'n3-reading-07',
        level: 'N3',
        subject: 'READING',
        questionType: 'INFO_RETRIEVAL',
        passage:
          '市民センター・工作室の予約\n利用時間：午前9時〜午後5時\n予約は利用日の前日午後5時まで、窓口またはウェブサイトで受け付けます。\n予約した開始時刻より早い時刻に変更する場合：前日午後5時までに窓口へ連絡してください。ウェブサイトでは変更できません。\n開始時刻を遅くする場合：当日でも窓口で変更できます。ただし、午後5時までに利用を終えてください。',
        questionText:
          '木曜日の午後2時に予約しています。同じ日の午前10時に変更したい場合、どうしますか。',
        options: [
          '木曜日の午前9時までにウェブサイトで変更します。',
          '水曜日の午後5時までにウェブサイトで変更します。',
          '木曜日の午後1時までに窓口へ連絡します。',
          '水曜日の午後5時までに窓口へ連絡します。'
        ],
        correctIndex: 3,
        explanationKo:
          '오후 2시에서 같은 날 오전 10시로 옮기는 것은 시작을 앞당기는 변경입니다. 이 경우 전날 오후 5시까지 창구에 연락해야 하므로 수요일 오후 5시까지 연락하는 선택이 맞습니다. 웹사이트는 예약 접수에는 사용할 수 있지만 변경에는 사용할 수 없습니다. 당일에도 변경 가능한 규칙은 시간을 늦추는 경우에만 해당합니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['정보 찾기', '예약 변경', '경로와 기한']
      }
    },
    {
      draftId: 'JLP-213-n3-reading-08-draft1',
      sha256:
        'e58dde7ecebce58cd48f6b6e4eadcaf91afec922c9ab66d0dc2d4eec8ea59524',
      registration: {
        id: 'n3-reading-08',
        level: 'N3',
        subject: 'READING',
        questionType: 'INFO_RETRIEVAL',
        passage:
          '交流会・持ち物の案内\n受付で名札を受け取ってください。\n発表する人：自分のパソコンを持参してください。会場のパソコンは使えません。発表資料は前日までにメールで送ってください。\n発表しない人：パソコンは必要ありません。\n全員：昼食は各自で用意してください。飲み物は会場にあります。\nただし、参加申込時に弁当を注文した人は、昼に受付で受け取れます。',
        questionText:
          '発表しない鈴木さんは、申込時に弁当を注文しました。案内に合っている行動はどれですか。',
        options: [
          'パソコンを持参し、前日までに発表資料を送ります。',
          'パソコンを持参する必要はなく、昼に受付で弁当を受け取ります。',
          '弁当を注文していても、必ず昼食を自分で持参します。',
          '会場のパソコンを借り、受付で飲み物を注文します。'
        ],
        correctIndex: 1,
        explanationKo:
          '발표하지 않는 사람에게는 컴퓨터가 필요하지 않습니다. 또한 신청 때 도시락을 주문한 사람은 점심에 접수처에서 받을 수 있으므로 해당 행동이 맞습니다. 컴퓨터와 발표 자료의 사전 전송은 발표자의 조건입니다. 점심은 각자 준비하는 것이 일반 규칙이지만 도시락을 주문한 사람에게 예외가 있습니다. 행사장 컴퓨터는 사용할 수 없고 접수처에서 음료를 주문하라는 안내도 없습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['정보 찾기', '역할별 조건', '준비물 예외']
      }
    }
  ],
  qaPass: 5,
  registered: 0,
  externalEducatorReview: false
} as const

// clientItemId is a logical content ID. Import returns newly allocated database IDs.
// Keep that returned mapping for subsequent review/publish and frontend parity.
export const createApprovedReadingBatch3Import = () =>
  validateQuestionImportRequestSchema.parse({
    items: approvedReadingBatch3.items.map(({ registration }) => ({
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
