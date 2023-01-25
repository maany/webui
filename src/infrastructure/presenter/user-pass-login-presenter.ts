import { UserPassLoginOutputPort } from '../../core/ports/auth/primary/user-pass-login-output-port'
import { AuthResponseModel } from '../../core/response-models/auth/auth-response-models';

export class UserPassLoginPresenter implements UserPassLoginOutputPort {
    presentLoginSuccess(responseModel: AuthResponseModel): void {
        throw new Error('Method not implemented.');
    }
    presentLoginFailure(responseModel: AuthResponseModel): void {
        throw new Error('Method not implemented.');
    }
}