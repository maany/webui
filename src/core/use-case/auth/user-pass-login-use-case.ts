import { UserPassLoginOutputPort } from "../../ports/auth/primary/user-pass-login-output-port"

export class UserPassLoginUseCase implements UseCase {
    constructor(private readonly outputPort: UserPassLoginOutputPort) {}
    // rucioAuthServer: UserPassLoginOutputPort
    execute(): void {
        throw new Error("Method not implemented.")
    }
}