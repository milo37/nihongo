import {
  adminQuestionContentInputSchema,
  validateQuestionImportRequestSchema
} from '@nihongo/contracts/admin/content-operations'

// JLP-256 internal QA; registration and release remain unverified.
export const approvedGrammarBatch5 = {
  items: [
    {
      draftId: 'JLP-255-n1-grammar-06-draft1',
      sha256:
        'c3f5606cd2e7bc7f28e0eb82bc63b02a89ac9510f29e381cf46b4953fc1d256f',
      registration: {
        id: 'n1-grammar-06',
        level: 'N1',
        subject: 'GRAMMAR',
        questionType: 'GRAMMAR_SELECT',
        questionText:
          '事故で右手を痛め、今は箸さえ持てない。料理を作る（　）、自分で食事をすることも難しい。',
        options: ['にひきかえ', 'どころか', 'に即して', 'とあって'],
        correctIndex: 1,
        explanationKo:
          '요리는커녕 젓가락을 들고 직접 식사하는 더 쉬운 일조차 어렵다는 뜻으로 「どころか」가 가장 적절합니다. 기대되는 행동 수준을 부정하고 더 기초적인 행동도 어렵다는 정도를 덧붙입니다. 비교 대조·기준에 따름·특별한 사정이라는 원인은 이 정도의 관계가 아닙니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['정도 대조', 'どころか', '식사'],
        passage: null
      }
    },
    {
      draftId: 'JLP-255-n1-grammar-07-draft1',
      sha256:
        'a11031c095ea2d4f9bc66284598eb2a80efed4f30a64d98b315815006095be8d',
      registration: {
        id: 'n1-grammar-07',
        level: 'N1',
        subject: 'GRAMMAR',
        questionType: 'GRAMMAR_SELECT',
        questionText:
          '全国大会の決勝戦（　）、選手だけでなく、普段は静かな観客まで声を張り上げて応援する。',
        options: ['をおいて', 'にかこつけて', 'ともなると', 'をよそに'],
        correctIndex: 2,
        explanationKo:
          '전국대회 결승전 정도의 특별한 단계가 되면 평소 조용하던 관객까지 열띠게 응원한다는 일반적인 양상을 말하므로 「ともなると」가 맞습니다. 특정 단계·상황에 이르면 나타나는 두드러진 변화를 표현합니다. 유일 후보·구실·개의치 않음은 이 관계가 아닙니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['특별한 단계', 'ともなると', '결승전'],
        passage: null
      }
    },
    {
      draftId: 'JLP-255-n1-grammar-08-draft1',
      sha256:
        '3acacfaa8bdcffb572fdb9d8d0b64675f6e3b341070c3f354a14210e2d7144a9',
      registration: {
        id: 'n1-grammar-08',
        level: 'N1',
        subject: 'GRAMMAR',
        questionType: 'GRAMMAR_SELECT',
        questionText:
          '公共の施設を管理する者（　）、自分の都合だけで利用者を選んではならない。',
        options: ['に至るまで', 'を限りに', 'にひきかえ', 'たるもの'],
        correctIndex: 3,
        explanationKo:
          '공공시설 관리자의 지위에 있는 사람이라면 마땅히 사적 편의만으로 이용자를 골라서는 안 된다는 규범이므로 「たるもの」가 맞습니다. 「〜たるもの」는 그 지위에 어울리는 책임·태도를 강조합니다. 범위 확장·종료·다른 대상과 대비하는 관계는 아닙니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['지위 당위', 'たるもの', '공공시설'],
        passage: null
      }
    },
    {
      draftId: 'JLP-255-n1-grammar-09-draft1',
      sha256:
        '9df54b71862ec99077d7da126d52aef50622c4095e0a73b107886851aaec44ed',
      registration: {
        id: 'n1-grammar-09',
        level: 'N1',
        subject: 'GRAMMAR',
        questionType: 'TEXT_GRAMMAR',
        questionText: '文章の（　）に入る最も適切なものを選んでください。',
        options: ['いかんでは', 'をものともせず', 'にかこつけて', 'をよそに'],
        correctIndex: 0,
        explanationKo:
          '실시 여부가 검사 결과에 달려 있고 결과에 따라 중지될 수도 있으므로 「いかんでは」가 맞습니다. 「〜いかんでは」는 조건의 내용이나 상태에 따라 다른 결과가 생길 가능성을 나타냅니다. 검사 결과를 극복·핑계·무시하는 방침이 아니라 안전 확인을 실제 결정 기준으로 삼고 있습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['조건 내용', 'いかんでは', '안전 검사'],
        passage:
          '研究施設では、試作品の安全性を外部機関に検査してもらっている。今月の公開実験は予定に入っているが、実施を最終決定したわけではない。検査結果（　）、公開実験を中止する場合もある。安全性が確認できた場合に限り、予定どおり実施する方針だ。'
      }
    },
    {
      draftId: 'JLP-255-n1-grammar-10-draft1',
      sha256:
        '545b9ae7bd290558f65fde36c67f3bd7f3afbe18be62bb87b3b4d446c1e116c0',
      registration: {
        id: 'n1-grammar-10',
        level: 'N1',
        subject: 'GRAMMAR',
        questionType: 'TEXT_GRAMMAR',
        questionText: '文章の（　）に入る最も適切なものを選んでください。',
        options: ['に至って', 'ものを', 'とあって', 'べからず'],
        correctIndex: 1,
        explanationKo:
          '일찍 상담했더라면 도울 수 있었을 텐데 이미 기회를 놓쳤다는 아쉬움이므로 「ものを」가 맞습니다. 실현되지 않은 바람직한 가능성을 뒤의 현실과 대비하며 유감이나 책망을 나타냅니다. 도울 수 있게 된 시점·사정에 따른 원인·금지는 이 지나간 기회에 대한 반응과 맞지 않습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['유감', 'ものを', '놓친 기회'],
        passage:
          '展示会の準備が間に合わなかったという後輩に、先輩は言った。「一人で全部やろうとせず、早めに相談してくれれば、手伝えた（　）。もう展示会は終わってしまったから、今回はどうしようもない。次からは困った時点で声をかけてほしい。」先輩は、過ぎてしまった機会を残念に思っている。'
      }
    }
  ],
  qaPass: 5,
  registered: 0,
  externalEducatorReview: false
} as const

// clientItemId is a logical content ID. Import returns newly allocated database IDs.
// Keep that returned mapping for subsequent review/publish and frontend parity.
export const createApprovedGrammarBatch5Import = () =>
  validateQuestionImportRequestSchema.parse({
    items: approvedGrammarBatch5.items.map(({ registration }) => ({
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
