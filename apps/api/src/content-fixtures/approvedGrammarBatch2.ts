import {
  adminQuestionContentInputSchema,
  validateQuestionImportRequestSchema
} from '@nihongo/contracts/admin/content-operations'

// JLP-236 internal review; this batch is separate from the immutable 65-question bootstrap.
export const approvedGrammarBatch2 = {
  items: [
    {
      draftId: 'JLP-234-n2-grammar-06-draft1',
      sha256:
        '36072dfe14321c7882f1298587a2285a0e89f9c9423bdbb270cc3940327e7715',
      registration: {
        id: 'n2-grammar-06',
        level: 'N2',
        subject: 'GRAMMAR',
        questionType: 'GRAMMAR_SELECT',
        questionText:
          'この講座は、参加者の経験（　）、初級・中級・上級の三つのクラスに分けて行います。',
        options: ['に反して', 'に応じて', 'を問わず', 'に先立って'],
        correctIndex: 1,
        explanationKo:
          '참가자의 경험 수준에 맞춰 세 반으로 나누므로 대응 기준을 나타내는 「に応じて」가 맞습니다. 경험에 반하거나 경험을 불문하는 운영이 아니며, 경험보다 앞서 시행한다는 시간 관계도 아닙니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['대응 기준', 'に応じて', '분반'],
        passage: null
      }
    },
    {
      draftId: 'JLP-234-n2-grammar-07-draft1',
      sha256:
        '8c3fe88920d81d95bba680672b7b7f426342355361742bd3fe7c5b7bff2af35e',
      registration: {
        id: 'n2-grammar-07',
        level: 'N2',
        subject: 'GRAMMAR',
        questionType: 'GRAMMAR_SELECT',
        questionText:
          'この施設では、年齢や国籍（　）、すべての利用者に同じ料金を適用します。',
        options: ['に応じて', 'に限って', 'を問わず', 'に基づいて'],
        correctIndex: 2,
        explanationKo:
          '모든 이용자에게 같은 요금을 적용하므로 나이와 국적을 불문하는 「を問わず」가 맞습니다. 나이나 국적에 따른 차등 적용·특정 대상 한정·근거에 따른 산정은 문장의 동일 요금 조건과 맞지 않습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['불문', 'を問わず', '시설 요금'],
        passage: null
      }
    },
    {
      draftId: 'JLP-234-n2-grammar-08-draft1',
      sha256:
        '3ccdbeb9f2472022e7c16533fe1dd7570dab009ca76e3bf8334e9f21d28fe22d',
      registration: {
        id: 'n2-grammar-08',
        level: 'N2',
        subject: 'GRAMMAR',
        questionType: 'GRAMMAR_SELECT',
        questionText:
          '料理の味は、使う材料（　）変わる。同じ作り方でも、材料が違えば仕上がりも違う。',
        options: ['次第で', '抜きで', 'どころか', 'に反して'],
        correctIndex: 0,
        explanationKo:
          '맛이 재료에 달려 있고 재료가 바뀌면 결과도 달라진다는 설명이므로 「次第で」가 맞습니다. 재료를 빼거나 재료에 반한다는 뜻이 아니며, 정도를 강조하는 「どころか」로도 이 의존 관계를 나타낼 수 없습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['의존 조건', '次第で', '재료'],
        passage: null
      }
    },
    {
      draftId: 'JLP-234-n2-grammar-09-draft2',
      sha256:
        '8916e4e236e775374ae75aaf757270982ff3c000dcd01fe9f5bc8cd2875cc146',
      registration: {
        id: 'n2-grammar-09',
        level: 'N2',
        subject: 'GRAMMAR',
        questionType: 'TEXT_GRAMMAR',
        questionText: '文章の（　）に入る最も適切なものを選んでください。',
        options: ['をきっかけに', 'にともなって', 'にわたって', 'に先立って'],
        correctIndex: 3,
        explanationKo:
          '목요일 설명회가 금요일 작업보다 먼저 열리고 작업 당일의 조작 어려움을 예방하려는 목적이므로, 작업 시작에 앞선 조치를 직접 나타내는 「に先立って」가 가장 적절합니다. 「にともなって」는 변화나 사건에 수반되는 관계를 나타내며 관련 조치가 먼저 이루어지는 문맥에도 쓰일 수 있습니다. 이 지문에서는 수반 관계보다 사전에 설명한다는 순서를 명시하는 표현이 더 직접적입니다. 「をきっかけに」는 작업 시작을 계기로 이후 설명한다는 관계, 「にわたって」는 기간·범위에 걸친 진행을 나타내므로 이 사전 설명의 순서에 맞지 않습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['사전 조치', 'に先立って', '설명회'],
        passage:
          '市民センターでは、初めて使う人のために機械の説明会を開く。説明会は木曜日で、実際の作業は金曜日から始まる。参加者が作業当日に操作で困らないよう、作業開始（　）、基本的な使い方を説明する予定だ。'
      }
    },
    {
      draftId: 'JLP-234-n2-grammar-10-draft1',
      sha256:
        'b69ba8294656fe61f509771b32fea7ec0033646cc9475d6c0105a82c3825b9cc',
      registration: {
        id: 'n2-grammar-10',
        level: 'N2',
        subject: 'GRAMMAR',
        questionType: 'TEXT_GRAMMAR',
        questionText: '文章の（　）に入る最も適切なものを選んでください。',
        options: ['以来', '初めて', 'ばかりか', 'からには'],
        correctIndex: 1,
        explanationKo:
          '구입 당일에는 사용할 수 없고 오늘부터 유효하므로 오늘이 되어서야 비로소 입장할 수 있다는 「初めて」가 맞습니다. 「〜て初めて」는 선행 조건이 성립한 뒤 비로소 가능한 일을 나타냅니다. 지속·추가·결심을 나타내는 다른 선지는 이 최초 가능 시점을 표현하지 못합니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['최초 가능', 'て初めて', '입장권 유효기간'],
        passage:
          'この水族館の入館券は、買った日には使えず、翌日から一週間有効です。昨日、田中さんは券を買いました。今日は有効期間の最初の日です。つまり、今日になって（　）、田中さんはその券で入館できるのです。'
      }
    }
  ],
  qaPass: 5,
  registered: 0,
  externalEducatorReview: false
} as const

// clientItemId is a logical content ID. Import returns newly allocated database IDs.
// Keep that returned mapping for subsequent review/publish and frontend parity.
export const createApprovedGrammarBatch2Import = () =>
  validateQuestionImportRequestSchema.parse({
    items: approvedGrammarBatch2.items.map(({ registration }) => ({
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
