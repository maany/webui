import { inject } from "inversify";
import { TYPES } from "../../../config/auth-config"
import { UserPassLoginOutputPort } from "../../ports/auth/primary/user-pass-login-output-port"
import { UseCase } from "../use-case"

export class UserPassLoginUseCase implements UseCase {
    @inject(TYPES.UserPassLoginOutputPort) _outputPort: UserPassLoginOutputPort
    
    // rucioAuthServer: UserPassLoginOutputPort
    execute(): void {
        throw new Error("Method not implemented.")
    }
}