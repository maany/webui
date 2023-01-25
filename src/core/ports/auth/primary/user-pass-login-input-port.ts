export interface UserPassLoginInputPort {
    login(username: string, password: string, account: string | null ): void
}