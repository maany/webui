export interface RucioAuthServerOutputPort {
    sendUserPassLoginRequest(username: string, password: string, account: string | null ): UserPassDTO
}