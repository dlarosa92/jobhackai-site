import { canonicalEnvironmentName } from './stripe-environment.js';

export function deletionWorkerSettings(env) {
  const mode=env.INACTIVITY_MODE ?? 'audit';
  const environment=canonicalEnvironmentName(env);
  const scope=env.INACTIVITY_TEST_UID==null || env.INACTIVITY_TEST_UID===''?null:env.INACTIVITY_TEST_UID;
  if(!['audit','execute'].includes(mode) || !['dev','qa','prod'].includes(environment) ||
      (scope!==null && (typeof scope!=='string'||!scope||scope.length>128||/\s/.test(scope))) ||
      (mode==='execute' && environment!=='prod' && !scope))throw new Error('inactivity_configuration_invalid');
  return {mode,environment,scope};
}
