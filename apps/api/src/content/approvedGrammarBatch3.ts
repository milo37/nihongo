import {
  adminQuestionContentInputSchema,
  validateQuestionImportRequestSchema
} from '@nihongo/contracts/admin/phase7'

// JLP-244 internal QA; registration and release remain unverified.
export const approvedGrammarBatch3 = {
  items: [
    {
      draftId: 'JLP-243-n3-grammar-06-draft3',
      sha256:
        'ed2726d80381b176f73e4a8346511bb2079a5d6cb3d3572d29262d1092cbfeb4',
      registration: {
        id: 'n3-grammar-06',
        level: 'N3',
        subject: 'GRAMMAR',
        questionType: 'GRAMMAR_SELECT',
        questionText:
          '駅前の店は、三か月前には二軒、先月には六軒、今月には十軒と、少しずつ増えている。この三か月に起きた変化を表す文として、最も適切なものを選んでください。「この道は、三か月前から今まで、少しずつにぎやかに（　）。」',
        options: [
          'なってきた',
          'なっていない',
          'なるはずがない',
          'ならなかった'
        ],
        correctIndex: 0,
        explanationKo:
          '점포 수가 세 달 전부터 지금까지 2→6→10개로 늘며 번화해 온 과정을 직접 나타내는 「なってきた」가 맞습니다. 이 문항은 관찰된 점진적 변화의 진행을 묻습니다. 다른 보기는 변화가 없거나 불가능하다는 부정이므로 제시된 증가 추세와 맞지 않습니다. 변화가 끝난 상태 뒤에도 추가 변화는 가능하므로, 완료 표현 일반을 지속과 모순이라고 배제하는 설명은 하지 않습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['변화 진행', 'てきた', '거리'],
        passage: null
      }
    },
    {
      draftId: 'JLP-243-n3-grammar-07-draft2',
      sha256:
        'ecf7965f2332925c435a986904941026f68476d81d5aa0856de6fa0b96970a30',
      registration: {
        id: 'n3-grammar-07',
        level: 'N3',
        subject: 'GRAMMAR',
        questionType: 'GRAMMAR_SELECT',
        questionText:
          'このアプリは、説明を読む（　）、使い方がよく分からない。説明を読むことに加えて、実際に使ってみる必要がある。',
        options: ['だけでなく', 'だけでは', 'おかげで', 'かわりに'],
        correctIndex: 1,
        explanationKo:
          '설명을 읽는 것만으로는 사용법을 잘 이해하지 못해 실제 사용도 필요하므로 「だけでは」가 맞습니다. 부족 조건을 직접 「使い方がよく分からない」에 연결했습니다. 「だけでなく」는 추가 요소를 나열하는 표현이지만 여기서는 첫 행동만으로 부족하다는 판단이 이어집니다. 「おかげで」는 긍정적인 원인, 「かわりに」는 대체 관계로 이 문맥과 맞지 않습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['부족 조건', 'だけでは', '사용법'],
        passage: null
      }
    },
    {
      draftId: 'JLP-243-n3-grammar-08-draft1',
      sha256:
        'dcaca54d3d952aea29785532090c9badf97e971b65140514b5ffd41e45b90533',
      registration: {
        id: 'n3-grammar-08',
        level: 'N3',
        subject: 'GRAMMAR',
        questionType: 'GRAMMAR_SELECT',
        questionText:
          '家を出ようとした（　）、電話が鳴ったので、出かける前に電話に出た。',
        options: ['ために', 'ままに', 'とたんに', 'ように'],
        correctIndex: 2,
        explanationKo:
          '집을 나서려던 바로 그 순간 전화가 울렸다는 뜻이므로 「とたんに」가 맞습니다. 「〜たとたんに」는 앞 행동이나 상황 직후의 갑작스러운 일을 나타냅니다. 목적·상태 유지·방식은 이 순간 관계에 맞지 않습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['순간', 'とたんに', '전화'],
        passage: null
      }
    },
    {
      draftId: 'JLP-243-n3-grammar-09-draft1',
      sha256:
        'eac2b4583e3b7c58f284f8363038db909366cd99b2bf3dd4ba6ca7bbb7ace51d',
      registration: {
        id: 'n3-grammar-09',
        level: 'N3',
        subject: 'GRAMMAR',
        questionType: 'TEXT_GRAMMAR',
        questionText: '文章の（　）に入る最も適切なものを選んでください。',
        options: ['たびに', 'とおりに', 'につれて', 'まで'],
        correctIndex: 3,
        explanationKo:
          '아직 방을 찾지 못했고 찾으면 곧 옮길 예정이므로 방을 찾을 때까지 친구 집에 머무는 「まで」가 맞습니다. 반복할 때마다·어떤 내용대로·점진적 변화에 따라라는 관계가 아니라 임시 체류가 끝나는 시점을 나타냅니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['종료 시점', 'まで', '임시 체류'],
        passage:
          '山田さんは新しい仕事のために引っ越す。駅に近い部屋を探していたが、今はまだ見つかっていない。そこで、部屋が見つかる（　）、友人の家に泊めてもらうことにした。部屋が決まったら、すぐにそこへ移る予定だ。'
      }
    },
    {
      draftId: 'JLP-243-n3-grammar-10-draft1',
      sha256:
        'c09bdbbf5f348f8aafb52516335fda97c0644adaac777aed355039ddbd761fbd',
      registration: {
        id: 'n3-grammar-10',
        level: 'N3',
        subject: 'GRAMMAR',
        questionType: 'TEXT_GRAMMAR',
        questionText: '文章の（　）に入る最も適切なものを選んでください。',
        options: ['そうだ', 'ところだ', 'わけがない', 'つもりだ'],
        correctIndex: 0,
        explanationKo:
          '이웃에게 들은 내용을 전달하므로 보통형 「飼っている」에 이어지는 전언의 「そうだ」가 맞습니다. 직접 본 외관 추측이 아니라 정보 출처가 명시된 전달입니다. 지금 막 하는 상태·불가능 단정·의도는 이미 들은 사육 사실의 전달과 맞지 않습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['전언', 'そうだ', '정보 출처'],
        passage:
          '佐藤さんは隣の席の同僚とよく話すが、その人の家には行ったことがない。ある日、同僚の近所に住む人から、その同僚が犬を二匹飼っていると聞いた。佐藤さんは別の友人に「同僚は犬を二匹飼っている（　）。近所の人がそう言っていたよ」と伝えた。'
      }
    }
  ],
  qaPass: 5,
  registered: 0,
  externalEducatorReview: false
} as const

// clientItemId is a logical content ID. Import returns newly allocated database IDs.
// Keep that returned mapping for subsequent review/publish and frontend parity.
export const createApprovedGrammarBatch3Import = () =>
  validateQuestionImportRequestSchema.parse({
    items: approvedGrammarBatch3.items.map(({ registration }) => ({
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
