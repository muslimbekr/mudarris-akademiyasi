(() => {
  const nav = document.getElementById('nav');
  const burger = document.getElementById('burger');
  const menu = document.getElementById('menu');
  const fab = document.querySelector('.fab');
  const form = document.getElementById('leadForm');
  const okBox = document.getElementById('leadOk');
  const failBox = document.getElementById('leadFail');
  const submitBtn = document.getElementById('leadSubmit');
  const leadbox = document.getElementById('ariza');

  /* ---------- Meta Pixel ---------- */
  const PIXEL_ID = (window.META_PIXEL_ID || '').trim();
  const pixelReady = /^\d{10,20}$/.test(PIXEL_ID);
  if (pixelReady) {
    /* eslint-disable */
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
    (window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */
    fbq('init', PIXEL_ID);
    fbq('track', 'PageView');
  } else {
    window.fbq = window.fbq || function () {};
    console.warn('[Mudarris] Meta Pixel ID not set — index.html ichidagi META_PIXEL_ID ni almashtiring.');
  }
  const track = (event, params, opts) => {
    try { opts ? window.fbq('track', event, params, opts) : window.fbq('track', event, params); }
    catch (_) {}
  };

  /* ---------- sticky nav + floating call button ---------- */
  const onScroll = () => {
    const y = window.scrollY;
    nav.classList.toggle('is-stuck', y > 8);
    fab.classList.toggle('is-on', y > 620);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- mobile menu ---------- */
  const setMenu = (open) => {
    menu.classList.toggle('is-open', open);
    burger.setAttribute('aria-expanded', String(open));
  };
  burger.addEventListener('click', () => setMenu(burger.getAttribute('aria-expanded') !== 'true'));
  menu.addEventListener('click', (e) => { if (e.target.tagName === 'A') setMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

  /* ---------- scroll reveal ---------- */
  const items = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('in'));
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry, i) => {
        if (!entry.isIntersecting) return;
        setTimeout(() => entry.target.classList.add('in'), i * 70);
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    items.forEach((el) => io.observe(el));
  }

  /* ---------- count-up stats ---------- */
  const fmt = (n) => (n >= 1000 ? n.toLocaleString('ru-RU').replace(/ /g, ' ') : String(n));
  const countUp = (el) => {
    const target = Number(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min((t - t0) / 1400, 1);
      el.textContent = fmt(Math.round(target * (1 - Math.pow(1 - p, 3)))) + suffix;
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nums = document.querySelectorAll('.stat b[data-count]');
  if (nums.length && 'IntersectionObserver' in window && !reduce) {
    const io2 = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        countUp(entry.target);
        io2.unobserve(entry.target);
      });
    }, { threshold: 0.6 });
    nums.forEach((el) => io2.observe(el));
  }

  /* ---------- jump to the form, prefilling course / branch ---------- */
  const setSelect = (field, value) => {
    if (!value) return;
    const f = form[field];
    if ([...f.options].some((o) => o.value === value)) f.value = value;
  };
  const labelOf = (field) => form[field].selectedOptions[0]?.text.trim() || '';

  const focusForm = (course, branch) => {
    setSelect('course', course);
    setSelect('branch', branch);
    leadbox.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    if (!okBox.hidden) return;
    setTimeout(() => { if (!form.name.value) form.name.focus({ preventScroll: true }); }, reduce ? 0 : 600);
  };

  document.querySelectorAll('.js-to-form').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      setMenu(false);
      focusForm(el.dataset.course, el.dataset.branch);
    });
  });

  document.querySelectorAll('.js-branch').forEach((el) => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.js-branch').forEach((b) => b.classList.remove('is-picked'));
      el.classList.add('is-picked');
      focusForm(null, el.dataset.branch);
    });
  });

  /* phone clicks are a conversion too */
  document.querySelectorAll('.js-call').forEach((el) => {
    el.addEventListener('click', () => track('Contact', { method: 'phone' }));
  });

  /* ---------- phone input formatting ---------- */
  const phone = form.phone;
  phone.addEventListener('input', () => {
    let d = phone.value.replace(/\D/g, '');
    if (d.startsWith('998')) d = d.slice(3);
    d = d.slice(0, 9);
    let out = '+998';
    if (d.length) out += ' ' + d.slice(0, 2);
    if (d.length > 2) out += ' ' + d.slice(2, 5);
    if (d.length > 5) out += ' ' + d.slice(5, 7);
    if (d.length > 7) out += ' ' + d.slice(7, 9);
    phone.value = out;
  });
  phone.addEventListener('focus', () => { if (!phone.value) phone.value = '+998 '; });
  phone.addEventListener('blur', () => { if (phone.value.replace(/\D/g, '') === '998') phone.value = ''; });

  /* ---------- validation ---------- */
  const showErr = (field, msg) => {
    const el = form[field];
    const err = form.querySelector(`.lf__err[data-for="${field}"]`);
    if (err) { err.textContent = msg || ''; err.classList.toggle('on', Boolean(msg)); }
    el.setAttribute('aria-invalid', msg ? 'true' : 'false');
    return !msg;
  };

  const validate = () => {
    let ok = true;
    ok = showErr('name', form.name.value.trim().length < 2 ? 'Ismingizni yozing' : '') && ok;
    const digits = form.phone.value.replace(/\D/g, '');
    ok = showErr('phone', digits.length !== 12 ? 'Telefon raqamini toʻliq kiriting' : '') && ok;
    return ok;
  };

  ['name', 'phone'].forEach((f) => {
    form[f].addEventListener('input', () => {
      if (form[f].getAttribute('aria-invalid') === 'true') validate();
    });
  });

  /* ---------- ad attribution ---------- */
  const cookie = (name) => {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  };
  const newEventId = () => (crypto.randomUUID
    ? crypto.randomUUID()
    : 'lead-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10));

  const qs = new URLSearchParams(location.search);
  const attribution = {
    utm_source: qs.get('utm_source') || '',
    utm_medium: qs.get('utm_medium') || '',
    utm_campaign: qs.get('utm_campaign') || '',
    utm_content: qs.get('utm_content') || '',
    fbclid: qs.get('fbclid') || '',
    referrer: document.referrer || '',
    landing: location.pathname
  };
  const openedAt = Date.now();

  /* ---------- submit ---------- */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    failBox.hidden = true;
    if (!validate()) {
      const bad = form.querySelector('[aria-invalid="true"]');
      if (bad) bad.focus();
      return;
    }

    submitBtn.classList.add('is-busy');
    /* One id for both copies of this conversion. Meta drops whichever arrives second. */
    const eventId = newEventId();
    const payload = {
      eventId,
      eventSourceUrl: location.href,
      fbp: cookie('_fbp'),          // Pixel's browser id
      fbc: cookie('_fbc'),          // Pixel's click id, set from fbclid on landing
      name: form.name.value.trim(),
      phone: form.phone.value.trim(),
      courseId: form.course.value,          // Bitrix enum id
      branchId: form.branch.value,
      course: form.course.value ? labelOf('course') : '',
      branch: form.branch.value ? labelOf('branch') : '',
      website: form.website.value,          // honeypot
      elapsed: Date.now() - openedAt,        // bots submit instantly
      ...attribution
    };

    try {
      const res = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);

      track('Lead', {
        content_name: payload.course || 'Aniqlanmagan',
        content_category: payload.branch || 'Aniqlanmagan'
      }, { eventID: eventId });
      document.querySelector('.lf__okphone').textContent = payload.phone;
      form.hidden = true;
      okBox.hidden = false;
      okBox.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    } catch (err) {
      failBox.textContent = 'Ariza yuborilmadi. Iltimos, qayta urinib koʻring yoki 78-113-73-53 raqamiga qoʻngʻiroq qiling.';
      failBox.hidden = false;
    } finally {
      submitBtn.classList.remove('is-busy');
    }
  });

  document.getElementById('yr').textContent = new Date().getFullYear();
})();
