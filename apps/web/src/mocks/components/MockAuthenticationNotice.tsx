import type { ReactElement } from 'react'

export const MockAuthenticationNotice = (): ReactElement => (
  <div
    id="mock-auth-notice"
    className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950"
    role="status"
  >
    <p className="font-black">Mock 데모 계정</p>
    <p>USER: user@example.com / Demo-user-2026!</p>
    <p>ADMIN: admin@example.com / Demo-admin-2026!</p>
    <p className="mt-1">
      회원가입·이메일 인증·비밀번호 재설정은 VITE_API_MODE=real인 실제 API
      모드에서 확인해 주세요.
    </p>
  </div>
)
