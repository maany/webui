import { Container } from 'inversify';
import { UserPassLoginPresenter } from '../infrastructure/presenter/user-pass-login-presenter';
import { UserPassLoginOutputPort } from '../core/ports/auth/primary/user-pass-login-output-port';
import { TYPES } from './auth-config';


const iocContainer = new Container();
iocContainer.bind<UserPassLoginOutputPort>(TYPES.UserPassLoginOutputPort).to(UserPassLoginPresenter);

export { iocContainer };