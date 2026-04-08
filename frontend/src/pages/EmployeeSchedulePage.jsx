import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import api from '../utils/api';
import { Badge } from '../components/UI';
import { fmtDay, fmtISO, getWeekDates } from '../utils/helpers';

export default function EmployeeSchedulePage({ user, toast }) {
  const [employee, setEmployee] = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const [employeeDetail, ownSchedules] = await Promise.all([
        user?.employee_id ? api.getEmployee(user.employee_id).catch(() => null) : Promise.resolve(null),
        api.getSchedules(),
      ]);
      setEmployee(employeeDetail);
      setSchedules(ownSchedules || []);
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [toast, user]);

  useEffect(() => {
    reload();
  }, [reload]);

  const weekDates = useMemo(() => getWeekDates(selectedDate, 0), [selectedDate]);
  const weekIsos = useMemo(() => weekDates.map(fmtISO), [weekDates]);
  const weekLabel = useMemo(
    () => `${fmtDay(weekDates[0])} - ${fmtDay(weekDates[6])}`,
    [weekDates],
  );

  const weekSchedules = useMemo(
    () =>
      schedules.filter((shift) => weekIsos.includes(shift.date)).sort((a, b) =>
        `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`),
      ),
    [schedules, weekIsos],
  );

  const totalHours = useMemo(
    () => weekSchedules.reduce((sum, shift) => sum + Number(shift.hours || 0), 0),
    [weekSchedules],
  );

  const upcomingSchedules = useMemo(
    () =>
      schedules
        .filter((shift) => shift.date >= fmtISO(new Date()))
        .sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`))
        .slice(0, 8),
    [schedules],
  );

  const moveWeek = (delta) => {
    setSelectedDate((current) => {
      const next = new Date(current);
      next.setDate(next.getDate() + delta * 7);
      return next;
    });
  };

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>
        Chargement de votre horaire...
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">
          <Calendar size={22} style={{ marginRight: 8, verticalAlign: 'text-bottom', color: 'var(--brand)' }} />
          Mon horaire
        </h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginBottom: 18 }}>
        <div className="card">
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Ressource</div>
          <div style={{ fontWeight: 700, color: 'var(--brand-d)' }}>{employee?.name || user?.name || '-'}</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>{employee?.position || 'Employé'}</div>
        </div>
        <div className="card">
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Heures cette semaine</div>
          <div style={{ fontWeight: 700, color: 'var(--brand-d)', fontSize: 24 }}>{totalHours.toFixed(2)} h</div>
        </div>
        <div className="card">
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Quarts cette semaine</div>
          <div style={{ fontWeight: 700, color: 'var(--brand-d)', fontSize: 24 }}>{weekSchedules.length}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ fontWeight: 700, color: 'var(--brand-d)' }}>Semaine du {weekLabel}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={() => moveWeek(-1)}>
              <ChevronLeft size={14} /> Précédente
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => moveWeek(1)}>
              Suivante <ChevronRight size={14} />
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 10 }}>
          {weekDates.map((date) => {
            const iso = fmtISO(date);
            const daySchedules = weekSchedules.filter((shift) => shift.date === iso);
            return (
              <div key={iso} style={{ background: 'var(--brand-xl)', border: '1px solid var(--border)', borderRadius: 14, padding: 12, minHeight: 150 }}>
                <div style={{ fontSize: 12, color: 'var(--brand)', fontWeight: 700, marginBottom: 10 }}>
                  {fmtDay(date)}
                </div>
                {daySchedules.length ? (
                  daySchedules.map((shift) => (
                    <div key={shift.id} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 10px', marginBottom: 8 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{shift.start} - {shift.end}</div>
                      <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>{shift.location || 'Lieu à confirmer'}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                        <span style={{ fontSize: 11, color: 'var(--text3)' }}>{Number(shift.hours || 0).toFixed(2)} h</span>
                        <Badge status={shift.status || 'published'} />
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>Aucun quart</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <Clock size={16} style={{ color: 'var(--brand)' }} />
          <div style={{ fontWeight: 700, color: 'var(--brand-d)' }}>Mes prochains quarts</div>
        </div>
        {upcomingSchedules.length ? (
          upcomingSchedules.map((shift) => (
            <div key={shift.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
              <div>
                <div style={{ fontWeight: 700 }}>{shift.date} | {shift.start} - {shift.end}</div>
                <div style={{ color: 'var(--text3)', marginTop: 3 }}>{shift.location || 'Lieu à confirmer'}</div>
              </div>
              <div style={{ color: 'var(--brand-d)', fontWeight: 700 }}>{Number(shift.hours || 0).toFixed(2)} h</div>
            </div>
          ))
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text3)' }}>Aucun quart publié à venir.</div>
        )}
      </div>
    </>
  );
}
