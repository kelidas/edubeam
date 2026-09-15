import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPinia, setActivePinia } from 'pinia';
import { DofID } from 'ts-fem';
import { Command, undoRedoManager, type IKeyValue } from '@/CommandManager';
import {
  askBeforeLeaving,
  executeModelMutationWithUndo,
  hasWorkToLose,
  leaveWithoutAsking,
  warnBeforeLeaving,
} from '@/utils';
import { useProjectStore } from '@/store/project';

/**
 * The model is written to storage as it is edited and comes back on its own; the steps that led to
 * it are only in memory. Leaving the page therefore keeps the work and loses every undo, which is
 * not obvious until one is wanted - and on a touch screen the gesture that leaves is a swipe.
 */
const leaving = () => {
  const event = { prevented: false, returnValue: undefined as unknown };

  return {
    event,
    asked: warnBeforeLeaving({
      preventDefault: () => (event.prevented = true),
      set returnValue(value: unknown) {
        event.returnValue = value;
      },
      get returnValue() {
        return event.returnValue;
      },
    } as unknown as BeforeUnloadEvent),
  };
};

describe('the undo history', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    undoRedoManager.clearHistory();
  });

  it('says when it holds nothing', () => {
    expect(undoRedoManager.canUndo()).toBe(false);
    expect(undoRedoManager.canRedo()).toBe(false);
  });

  it('says when it holds a step, and when that step has been taken back', () => {
    undoRedoManager.executeCommand(
      new Command<IKeyValue>(
        () => {},
        () => {},
        {}
      )
    );

    expect(undoRedoManager.canUndo()).toBe(true);
    expect(undoRedoManager.canRedo()).toBe(false);

    undoRedoManager.undo();

    expect(undoRedoManager.canUndo()).toBe(false);
    expect(undoRedoManager.canRedo()).toBe(true);
  });
});

describe('leaving the page', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    undoRedoManager.clearHistory();
  });

  it('goes unremarked when nothing has been done', () => {
    const { asked, event } = leaving();

    expect(asked).toBe(false);
    expect(event.prevented).toBe(false);
  });

  it('is questioned once the model has been changed', () => {
    const store = useProjectStore();

    store.solver.domain.createNode('1', [0, 0, 0], [DofID.Dx, DofID.Dz]);
    executeModelMutationWithUndo(() => store.solver.domain.createNode('2', [4, 0, 0], [DofID.Dz]));

    expect(hasWorkToLose()).toBe(true);

    const { asked, event } = leaving();

    expect(asked).toBe(true);
    expect(event.prevented).toBe(true);
    // what older browsers read instead of the call, whatever it is set to
    expect(event.returnValue).toBe('');
  });
});

describe('tidying the address bar', () => {
  const APP = readFileSync(join(process.cwd(), 'src/App.vue'), 'utf-8');

  /**
   * A shared link is read as the app starts: it clears the mesh and loads the model it carries. An
   * entry left behind in the history is therefore not merely a stale address - going back to it
   * loads that model over whatever has been built since.
   */
  it('leaves nothing in the history to go back to', () => {
    expect(APP).not.toContain('history.pushState');
    expect(APP).toContain('history.replaceState');
  });

  it('still takes the parameters out of the address', () => {
    const tidies = APP.split('history.replaceState').length - 1;

    // one for a shared model, one for a language or a panel
    expect(tidies).toBe(2);
  });
});

/**
 * An update reloads the page itself, and the undo history goes with it either way - that is what
 * taking a new version costs. Asking whether to allow a reload the reader has just asked for is
 * noise, and a dialog they could answer wrongly, leaving the update half done.
 */
describe('a reload the reader asked for', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    undoRedoManager.clearHistory();
    askBeforeLeaving();
  });

  const withWork = () => {
    const store = useProjectStore();

    store.solver.domain.createNode('1', [0, 0, 0], [DofID.Dx, DofID.Dz]);
    executeModelMutationWithUndo(() => store.solver.domain.createNode('2', [4, 0, 0], [DofID.Dz]));
  };

  it('goes unquestioned', () => {
    withWork();
    leaveWithoutAsking();

    expect(leaving().asked).toBe(false);
  });

  it('is questioned again if the leaving does not happen after all', () => {
    withWork();
    leaveWithoutAsking();
    askBeforeLeaving();

    expect(leaving().asked).toBe(true);
  });

  it('is what the update does, and puts back if it fails', () => {
    const prompt = readFileSync(join(process.cwd(), 'src/components/ReloadPrompt.vue'), 'utf-8');
    const update = prompt.slice(prompt.indexOf('async function update()'));

    expect(update).toContain('leaveWithoutAsking()');
    // the catch is the one path out of it that leaves the page standing
    expect(update.slice(update.indexOf('catch'))).toContain('askBeforeLeaving()');
  });
});
