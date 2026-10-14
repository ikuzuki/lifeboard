import { ItemCard } from '../components/ItemCard';
import { Empty, LaneHeading, Lanes } from '../components/Lane';
import { useStore } from '../store';
import { buyHorizon, isArchived, isLive, type Horizon } from '../lib/dates';
import type { Item, Weight } from '../types';

/**
 * Derived from `act`, not stored. Give a purchase a date and it lands in the right group;
 * push the date back and it moves on its own. Wishlist is the undated one, which is the
 * rule already: an undated purchase is something you want, not something you have planned.
 */
const HORIZONS: { horizon: Horizon; label: string; weight: Weight }[] = [
  { horizon: 'this-month', label: 'This month', weight: 'lead' },
  { horizon: 'next-month', label: 'Next month', weight: 'normal' },
  { horizon: 'later', label: 'Later', weight: 'quiet' },
  { horizon: 'wishlist', label: 'Wishlist', weight: 'quiet' },
];

const sum = (rows: Item[]) => rows.reduce((n, i) => n + (i.cost ?? 0), 0);

/**
 * No headline. The list is the content, and a count of it is not a fact worth the
 * biggest type in the app. Money is one quiet line, and only where a price exists.
 */
export function BuyView({
  onOpen,
  onComplete,
}: {
  onOpen: (id: string) => void;
  onComplete: (id: string) => void;
}) {
  const { state } = useStore();
  const buys = state.items.filter((i) => i.buy && !isArchived(i));
  const open = buys.filter(isLive);
  const priced = open.filter((i) => i.cost !== null);
  const bought = buys.filter((i) => i.status === 'done');
  const spent = sum(bought);

  return (
    <div>
      {(priced.length > 0 || spent > 0) && (
        <p className="pt-1 pb-2 text-meta" style={{ color: 'var(--muted-foreground)' }}>
          {priced.length > 0 && (
            <span className="mono">
              £{sum(priced).toLocaleString()}
              <span className="font-sans"> so far</span>
              {priced.length < open.length && (
                <span className="font-sans">
                  , {open.length - priced.length} without a price
                </span>
              )}
            </span>
          )}
          {spent > 0 && (
            <span className="mono">
              {priced.length > 0 && <span aria-hidden="true"> · </span>}£{spent.toLocaleString()}
              <span className="font-sans"> bought</span>
            </span>
          )}
        </p>
      )}

      <Lanes>
        {HORIZONS.map(({ horizon, label, weight }) => {
          // Bought items are excluded here. They used to sit inside their horizon and sort
          // above things still needed, which put the finished thing at the top of the list of
          // unfinished ones.
          const rows = open.filter((i) => buyHorizon(i) === horizon);
          if (rows.length === 0) return null;
          const total = sum(rows.filter(isLive));
          return (
            <section key={label}>
              <LaneHeading count={rows.length} weight={weight}>
                {label}
                {total > 0 && (
                  <span className="mono font-normal" style={{ color: 'var(--muted-foreground)' }}>
                    {' '}
                    £{total.toLocaleString()}
                  </span>
                )}
              </LaneHeading>
              <ul className={`flex flex-col ${weight === 'lead' ? 'gap-2' : 'gap-1.5'}`}>
                {rows.map((i) => (
                  <ItemCard key={i.id} item={i} onOpen={onOpen} onComplete={onComplete} weight={weight} />
                ))}
              </ul>
            </section>
          );
        })}

        {/* Today has a Done today group for the same reason: what you just finished is worth
            seeing, at the bottom, until the day turns over and it goes to the archive. */}
        {bought.length > 0 && (
          <section>
            <LaneHeading count={bought.length} weight="quiet">
              Bought
              {sum(bought) > 0 && (
                <span className="mono font-normal" style={{ color: 'var(--muted-foreground)' }}>
                  {' '}
                  £{sum(bought).toLocaleString()}
                </span>
              )}
            </LaneHeading>
            <ul className="flex flex-col gap-1.5">
              {bought.map((i) => (
                <ItemCard key={i.id} item={i} onOpen={onOpen} onComplete={onComplete} weight="quiet" />
              ))}
            </ul>
          </section>
        )}
      </Lanes>

      {buys.length === 0 && <Empty>Nothing on the shopping list.</Empty>}
    </div>
  );
}
