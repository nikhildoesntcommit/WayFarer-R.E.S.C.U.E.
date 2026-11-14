"""Train the estimator model on simulator output and export it as JSON for the browser.
usage: python3 scripts/surrogate/train.py src/ai/surrogate-weights.json ds1.jsonl ds2.jsonl ..."""
import json, sys
import numpy as np
from sklearn.neural_network import MLPRegressor
from sklearn.linear_model import Ridge
from sklearn.model_selection import train_test_split

out, files = sys.argv[1], sys.argv[2:]
rows = [json.loads(l) for f in files for l in open(f) if l.strip()]
X = np.array([r['f'] for r in rows], float)
Y = np.column_stack([np.log([r['p95'] for r in rows]), np.log([r['p50'] for r in rows]), np.sqrt([r['lost'] for r in rows])])
Xtr, Xte, Ytr, Yte = train_test_split(X, Y, test_size=0.2, random_state=7)
mx, sx = Xtr.mean(0), Xtr.std(0) + 1e-9
my, sy = Ytr.mean(0), Ytr.std(0) + 1e-9
n = lambda x: (x - mx) / sx
best = None
for seed in range(5):
    m = MLPRegressor(hidden_layer_sizes=(32, 32), activation='relu', alpha=1e-3, max_iter=3000, early_stopping=True, n_iter_no_change=40, random_state=seed)
    m.fit(n(Xtr), (Ytr - my) / sy)
    score = m.score(n(Xte), (Yte - my) / sy)
    if best is None or score > best[0]: best = (score, m)
m = best[1]
pred = m.predict(n(Xte)) * sy + my
lin = Ridge(alpha=1.0).fit(n(Xtr), (Ytr - my) / sy)
lpred = lin.predict(n(Xte)) * sy + my

def report(p, name):
    p95, t95 = np.exp(p[:, 0]), np.exp(Yte[:, 0])
    lost, tlost = p[:, 2].clip(0) ** 2, Yte[:, 2] ** 2
    ss = lambda a, b: 1 - ((a - b) ** 2).sum() / ((a - a.mean()) ** 2).sum()
    return dict(model=name, p95_mape_pct=float(100 * np.mean(np.abs(p95 - t95) / t95)), p95_r2_log=float(ss(Yte[:, 0], p[:, 0])),
                p50_r2_log=float(ss(Yte[:, 1], p[:, 1])), lost_mae_pct_points=float(100 * np.mean(np.abs(lost - tlost))),
                p95_within_20pct=float(np.mean(np.abs(p95 - t95) / t95 < 0.2)))
mlp_r, lin_r = report(pred, 'mlp'), report(lpred, 'linear')
print(len(rows), 'scenarios;', 'test', len(Xte)); print(mlp_r); print(lin_r)
# residual spread in log space: used for the "typical error" band shown in the app
resid = (pred[:, 0] - Yte[:, 0])
band = float(np.quantile(np.abs(resid), 0.8))
r = lambda a: np.round(a, 6).tolist()
json.dump(dict(
    version=1, n_train=int(len(Xtr)), n_test=int(len(Xte)), features=['ln_people', 'mean_exit_time_s', 'p90_exit_time_s', 'capacity_pps', 'clear_time_s', 'n_exits', 'alarm_s', 'fire', 'fire_to_exit_m', 'fire_to_people_m', 'vulnerable_share'],
    mean=r(mx), std=r(sx), outMean=r(my), outStd=r(sy),
    layers=[dict(W=r(c.T), b=r(b)) for c, b in zip(m.coefs_, m.intercepts_)],
    lo=r(np.quantile(X, 0.005, axis=0)), hi=r(np.quantile(X, 0.995, axis=0)), band80Log=round(band, 4), metrics=dict(mlp=mlp_r, linear=lin_r),
), open(out, 'w'), separators=(',', ':'))
