/** Admin error messages; kept out of the shared Korean chunk. */
export const koAdminErrorsResources = {
  generic: '관리자 요청을 완료하지 못했습니다.',
  offline: '오프라인 상태입니다. 입력과 선택은 유지됩니다.',
  authenticationRequired: '로그인이 필요합니다. 다시 로그인해 주세요.',
  sessionExpired: '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.',
  adminRequired: '관리자 권한이 필요합니다.',
  forbidden: '이 관리자 작업을 실행할 권한이 없습니다.',
  freshAssuranceRequired: '이 작업을 실행하려면 관리자 본인 확인이 필요합니다.',
  invalidId: '요청 식별자 형식이 올바르지 않습니다.',
  invalidRequest: '요청 형식이 올바르지 않습니다. 입력을 확인해 주세요.',
  requestTooLarge: '요청 크기가 허용 범위를 초과했습니다.',
  validation: '입력 내용을 확인해 주세요.',
  notFound: '요청한 관리자 자료를 찾을 수 없습니다.',
  versionConflict: '다른 작업에서 최신 상태가 변경되었습니다.',
  questionVersionImmutable: '이 문제 버전은 더 이상 수정할 수 없습니다.',
  invalidState: '현재 상태에서는 이 작업을 실행할 수 없습니다.',
  separationOfDuties:
    '작성과 검수 역할을 분리해야 하므로 이 작업을 실행할 수 없습니다.',
  duplicateQuestionContent:
    '보관된 문제를 포함해 같은 내용의 문제가 이미 있습니다. 문구를 바꿔 다시 저장해 주세요.',
  untrustedOrigin: '허용되지 않은 요청 출처입니다.',
  rateLimited: '요청이 너무 많습니다.',
  server: '서버에서 관리자 요청을 처리하지 못했습니다.',
  unavailable: '관리자 기능을 잠시 사용할 수 없습니다.',
  reportDuplicate: '같은 문제 버전에 처리 중인 신고가 이미 있습니다.',
  importIdentityConflict: '가져오기 항목의 식별자가 기존 자료와 충돌합니다.',
  importValidationFailed: '가져오기 검증 결과가 현재 요청과 일치하지 않습니다.',
  reauthenticationFailed: '연결한 계정으로 본인 확인을 완료하지 못했습니다.',
  fieldInvalid: '이 입력값을 확인해 주세요.'
} as const
