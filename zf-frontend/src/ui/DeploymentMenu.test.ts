import { describe, expect, it, vi } from 'vitest';
import { SoldierClassId } from '../player/SoldierClass';
import { DeploymentMenu } from './DeploymentMenu';

describe('DeploymentMenu', () => {
  it('renders six classes and deploys the selected definition', () => {
    const menu = new DeploymentMenu();
    const onDeploy = vi.fn();
    menu.onDeploy = onDeploy;

    const medic = menu.container.querySelector<HTMLElement>('[data-class="medic"]');
    medic?.click();
    menu.container.querySelector<HTMLElement>('#deploy-button')?.click();

    expect(menu.container.querySelectorAll('[data-class]')).toHaveLength(6);
    expect(onDeploy).toHaveBeenCalledWith(expect.objectContaining({ id: SoldierClassId.MEDIC }));
    menu.dispose();
  });
});
