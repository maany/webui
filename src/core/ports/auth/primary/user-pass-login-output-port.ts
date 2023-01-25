import { AuthResponseModel } from "../../../response-models/auth/auth-response-models"

export interface UserPassLoginOutputPort { 
    presentLoginSuccess(responseModel: AuthResponseModel): void
    presentLoginFailure(responseModel: AuthResponseModel): void
}