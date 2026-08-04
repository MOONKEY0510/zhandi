import { describe, expect, it, vi } from 'vitest';
import { SoldierClassId } from '../player/SoldierClass';
import { DeploymentMenu } from './DeploymentMenu';

describe('DeploymentMenu', () => {
  it('renders four classes and deploys the selected definition', () => {
    const menu = new DeploymentMenu();
    const onDeploy = vi.fn();
    menu.onDeploy = onDeploy;

    const medic = menu.container.querySelector<HTMLElement>('[data-class="medic"]');
    medic?.click();
    menu.container.querySelector<HTMLElement>('#deploy-button')?.click();

    expect(menu.container.querySelectorAll('[data-class]')).toHaveLength(4);
    expect(onDeploy).toHaveBeenCalledWith(expect.objectContaining({ id: SoldierClassId.MEDIC }));
    menu.dispose();
  });
});
