import { ResponseModel } from "../../../response-models/auth/auth-response-models"

export interface UserPassLoginOutputPort { 
    presentLoginSuccess(responseModel: ResponseModel): void
    presentLoginFailure(responseModel: ResponseModel): void
}