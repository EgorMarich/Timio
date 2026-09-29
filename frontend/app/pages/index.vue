<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const mobileOpen = ref(false);

const items = ['BOOKING', 'CRM', 'TEAM', 'ANALYTICS', 'MARKETING']

const appHref = computed(() => auth.isAuthenticated ? "/app" : "/login");
</script>

<template>
  <div class="landing">
    <header class="landing-nav">
      <NuxtLink to="/" class="landing-brand" aria-label="Timio">
        <img class="logo" src="/logo.svg" alt="Timio" />
      </NuxtLink>
      <nav class="landing-links" :class="{ open: mobileOpen }">
        <a href="#product" @click="mobileOpen = false">Возможности</a>
        <a href="#workflow" @click="mobileOpen = false">Как работает</a>
        <a href="#pricing" @click="mobileOpen = false">Тарифы</a>
        <NuxtLink :to="appHref" class="nav-login" @click="mobileOpen = false">Войти</NuxtLink>
      </nav>
      <button class="mobile-menu" type="button" aria-label="Открыть меню" @click="mobileOpen = !mobileOpen">☰</button>
    </header>

    <main>
      <section class="hero section-wrap">
        <div class="hero-copy">
          <div class="title">
            <h1>Меньше<br />всякой рутины.</h1>
            <h1><span>Больше клиентов.</span></h1>
          </div>
          <p class="hero-subtitle">Timio объединяет онлайн-запись, расписание, клиентов, команду и аналитику в одном рабочем пространстве.</p>
          <div class="hero-actions">
            <NuxtLink to="/register" class="hero-primary">Начать бесплатно</NuxtLink>
            <a href="#product" class="hero-secondary">Посмотреть возможности</a>
          </div>
        </div>

        <div class="hero-product" aria-label="Предпросмотр панели Timio">
          <div class="browser-bar"><span /><span /><span /><b>app.timio</b></div>
          <div class="mock-shell">
            <aside class="mock-sidebar">
              <div class="mock-logo"><i>T</i> Timio</div>
              <div class="mock-nav active">⌂ <span>Сегодня</span></div>
              <div class="mock-nav">▤ <span>Расписание</span></div>
              <div class="mock-nav">◎ <span>Клиенты</span></div>
              <div class="mock-separator" />
              <div class="mock-nav">◇ <span>Услуги</span></div>
              <div class="mock-nav">◍ <span>Сотрудники</span></div>
              <div class="mock-nav">↗ <span>Аналитика</span></div>
            </aside>
            <div class="mock-main">
              <div class="mock-top"><div><small>ПОНЕДЕЛЬНИК, 14 СЕНТЯБРЯ</small><strong>Сегодня</strong></div><button>+ Запись</button></div>
              <div class="mock-stats">
                <div><small>Записи</small><strong>18</strong><em>+12% к прошлому</em></div>
                <div><small>Выручка</small><strong>47 500 ₽</strong><em>+8.4%</em></div>
                <div><small>Новые клиенты</small><strong>6</strong><em>за сегодня</em></div>
              </div>
              <div class="mock-panel">
                <div class="mock-panel-head"><strong>Ближайшие записи</strong><span>Все</span></div>
                <div class="mock-appointment"><b>09:00</b><span class="mock-avatar">АК</span><div><strong>Анна К.</strong><small>Стрижка · Алексей</small></div><mark>2 500 ₽</mark></div>
                <div class="mock-appointment"><b>10:30</b><span class="mock-avatar second">МС</span><div><strong>Мария С.</strong><small>Маникюр · Ольга</small></div><mark>3 200 ₽</mark></div>
                <div class="mock-appointment"><b>12:00</b><span class="mock-avatar third">ИВ</span><div><strong>Иван В.</strong><small>Стрижка + борода · Алексей</small></div><mark>3 500 ₽</mark></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="trust-strip">
        <div class="section-wrap trust-inner">
        <template v-for="(item, i) in items" :key="item">
          <b>{{ item }}</b>
          <img class="trust-icon" v-if="i < items.length - 1" src="/icons/shape.svg" :alt="item" />
        </template>
        </div> 
      </section>

      <section id="workflow" class="section-wrap workflow section-space">
        <div class="section-heading"><h2>От первой записи<br />до повторного визита.</h2><p>Timio связывает процессы, которые обычно разбросаны по мессенджерам, таблицам и заметкам.</p></div>
        <div class="workflow-grid">
          <div v-for="(item, i) in [
            ['01','BOOK','Клиент записывается онлайн','Публичная страница с услугами, специалистами и свободным временем.'],
            ['02','OPERATE','Работа по расписанию','У каждого сотрудника свои услуги, график и понятный рабочий день.'],
            ['03','KNOW','Вы видите цифры','Клиенты и эффективность сотрудников — без ручных таблиц.'],
            ['04','GROW','Возвращаете клиентов','Напоминания, сегменты и маркетинговые кампании.']
          ]" :key="item[0]" class="workflow-card">
            <span class="workflow-num">{{ item[0] }}</span><span class="workflow-label">{{ item[1] }}</span><h3>{{ item[2] }}</h3><p>{{ item[3] }}</p><img class="arrow-icon" src="/icons/arrow.svg" alt="Next" />
          </div>
        </div>
      </section>

      <section id="product" class="section-wrap product-section section-space">
        <div class="section-heading"><h2>Всё, что нужно<br />для управления бизнесом.</h2></div>
        <div class="feature-grid">
          <article class="feature-card feature-large"><div class="feature-copy"><span>01 / SCHEDULE</span><div class="feature-text"><h3>Расписание, которое работает за вас</h3><p>Дни, сотрудники, услуги и статусы записей в одном месте.<br/> Быстро понять, что происходит сегодня.</p></div></div><div class="calendar-mock"><div v-for="row in [['09:00','Анна К.','Стрижка'],['10:30','Мария С.','Маникюр'],['12:00','Иван В.','Стрижка + борода'],['14:30','Ольга П.','Окрашивание']]" :key="row[0]" class="calendar-row"><b>{{ row[0] }}</b><span><strong>{{ row[1] }}</strong><small>{{ row[2] }}</small></span></div></div></article>
          <article class="feature-card"><span>02 / CRM</span><div class="feature-text"><h3>Клиенты — не просто записи</h3><p>История визитов, контакты, траты и заметки<br /> помогают знать своих клиентов.</p></div><div class="mini-client"><span>АК</span><div><strong>Анна Кузнецова</strong><small>12 визитов · 34 500 ₽</small></div></div></article>
          <article class="feature-card"><span>03 / TEAM</span><div class="feature-text"><h3>Команда без путаницы</h3><p>Сотрудники, услуги, графики<br />и рабочая загрузка на виду.</p></div><div class="team-dots"><i>АК</i><i>ОП</i><i>МС</i><i>+4</i></div></article>
          <article class="feature-card feature-dark"><span>04 / GROWTH</span><div class="feature-text"><h3>Возвращайте тех, кто уже вас знает</h3><p>Находите клиентов, которым пора напомнить о следующем визите, и запускайте кампании.</p></div><div class="growth-stat"><strong>+18%</strong><small>повторных записей</small></div></article>
        </div>
      </section>

      <section class="section-wrap ai-section section-space">
        <div class="ai-card"><div class="ai-copy"><div class="section-kicker">TIMIO INTELLIGENCE</div><h2>Не просто показывает цифры.<br /><span>Помогает понять, что делать.</span></h2><p>Следующий слой Timio — рекомендации владельцу: кого вернуть, где перегружена команда, какие услуги растут и где бизнес теряет деньги.</p><NuxtLink to="/register" class="text-link">Попробовать Timio →</NuxtLink></div><div class="ai-panel"><div class="ai-header"><span class="ai-badge">AI</span><div><strong>Сегодня стоит обратить внимание</strong><small>обновлено только что</small></div></div><div class="ai-item"><b>03</b><div><strong>клиентам пора напомнить</strong><small>Последний визит 27–34 дня назад</small></div><span>→</span></div><div class="ai-item"><b>01</b><div><strong>сотрудник недозагружен</strong><small>Свободно 3 слота завтра</small></div><span>→</span></div><div class="ai-item"><b>+12%</b><div><strong>услуга растёт быстрее остальных</strong><small>Стрижка + борода за 30 дней</small></div><span>→</span></div></div></div>
      </section>

      <section id="pricing" class="section-wrap pricing section-space">
        <div class="section-heading"><h2>Начните с малого.<br />Растите вместе с Timio.</h2><p>Без сложной настройки. Выбирайте тариф по размеру команды.</p></div>
        <div class="pricing-grid pricing-two">
          <article v-for="plan in [
            {name:'Стартовый', price:'1 999 ₽', note:'1 сотрудник', features:['Онлайн-запись','Расписание и услуги','Клиенты и история','Напоминания']},
            {name:'Базовый', price:'2 999 ₽', note:'до 5 сотрудников', popular:true, features:['Онлайн-запись','Расписание и услуги','Клиенты и история','Напоминания']},
            {name:'Бизнес', price:'5 490 ₽', note:'от 5 сотрудников + 390 ₽ за каждого следующего', features:['Всё из Базового','Аналитика','Маркетинг и возврат','Командная работа','Расширение без миграции']}
          ]" :key="plan.name" class="price-card" :class="{ popular: plan.popular }"><div class="popular-badge" v-if="plan.popular">ПОПУЛЯРНЫЙ</div><span>{{ plan.name }}</span><strong>{{ plan.price }}<small>/мес</small></strong><p>{{ plan.note }}</p><ul><li v-for="feature in plan.features" :key="feature"> {{ feature }}</li></ul><NuxtLink to="/register" :class="plan.popular ? 'price-primary' : 'price-secondary'">14 дней бесплатно</NuxtLink></article>
        </div>
      </section>

      <section class="section-wrap final-cta section-space"><div><h2>Ваш бизнес должен работать<br /><em>на вас.</em></h2><p>Запустите Timio и соберите ежедневную работу команды в одном месте.</p></div><NuxtLink to="/register" class="hero-primary">Создать компанию бесплатно</NuxtLink></section>
    </main>

    <footer class="landing-footer"><div class="section-wrap footer-inner"><div><div class="landing-brand"><img class="logo" src="/logo.svg" alt="Timio" /></div></div><div class="footer-links"><NuxtLink to="/privacy">Конфиденциальность</NuxtLink><NuxtLink to="/terms">Условия</NuxtLink><NuxtLink to="/login">Войти</NuxtLink></div><small>© {{ new Date().getFullYear() }} Timio</small></div></footer>
  </div>
</template>

<style scoped>

.landing {
  padding-top: 22px;
  min-height:100vh;
  background:#f4f2ee;
  color:#18181b
}

.logo {
  width: 160px;
  height: 120px;
}



.title { 
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.title h1 {
  line-height: 0.8 !important;
}

.section-wrap {
  width:min(1280px,calc(100% - 40px));
  margin:0 auto
}

.landing-nav {
  height:72px;
  width:min(1240px,calc(100% - 40px));
  margin:auto;
  display:flex;
  align-items:center;
  justify-content:space-between
}

.landing-brand {
  display:flex;
  align-items:center;
  gap:10px;
  font-weight:900;
  font-size:19px;
  letter-spacing:-.04em
}

.brand-mark {
  width:31px;
  height:31px;
  border-radius:9px;
  background:#ff4438;
  color:#fff;
  display:grid;
  place-items:center;
  font-size:14px
}

.landing-links {
  display:flex;
  align-items:center;
  gap:30px;
  font-size: 16px;
  font-weight:600;
  color:#71717a
}

.landing-links a:hover {
  color:#18181b
}

.nav-login {
  color:#18181b!important;
  border:1px solid #e8e8ea;
  border-radius:4px;
  padding:8px 12px;
  background:#fff
}

.mobile-menu {
  display:none;
  border:0;
  background:none;
  font-size:22px 
}

.hero {
  display:grid;
  grid-template-columns:.85fr 1.15fr;
  gap:60px;
  align-items:center;
  padding:92px 0 105px 
} 
.eyebrow,.section-kicker {
  font:700 10px/1.2 'Roboto Mono',monospace;
  letter-spacing:.13em;
  color:#a1a1aa
}

.eyebrow-dot {
  display:inline-block;
  width:6px;
  height:6px;
  border-radius:50%;
  background:#ff4438;
  margin-right:8px 
}

.hero h1 {
  font-size:clamp(48px,6vw,78px);
  line-height:.98;letter-spacing:-.065em;
  margin:20px 0
}
.hero h1 span {
  color:#ff4438
}
.hero-subtitle {
  max-width:560px;
  font-size:18px;
  line-height:1.55;
  color:#71717a;
  margin:0 0 28px
}
.hero-actions {
  display:flex;
  gap:12px;
  align-items:center
}
.hero-primary, .hero-secondary, .price-primary, .price-secondary {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:16px;
  border-radius: 4px;
  padding:14px 19px;
  font-weight:700;
  font-size:13px
}.hero-primary,.price-primary {
  background:#ff4438;
  color:white 
}
.hero-primary:hover, .price-primary:hover {
    background:#ff5b50
  }
  .hero-secondary,.price-secondary {
    border:1px solid #e8e8ea;
    background:white
  }
  .hero-secondary:hover,.price-secondary:hover {
    border-color:#cfcfd3
  }
  .hero-proof {
    display:flex;
    gap:14px;
    margin-top:17px;
    color:#a1a1aa;
    font-size:11px
  }.hero-proof span{color:#16a34a;font-weight:800}.hero-product{border:1px solid #dfe0e3;border-radius:15px;background:#fff;overflow:hidden;box-shadow:0 25px 60px -35px rgba(16,16,20,.28);transform:rotate(.4deg)}.browser-bar{height:31px;border-bottom:1px solid #ececed;display:flex;align-items:center;padding:0 11px;gap:5px;color:#a1a1aa}.browser-bar span{width:6px;height:6px;border-radius:50%;background:#d4d4d8}.browser-bar b{margin-left:10px;font:500 9px 'Roboto Mono',monospace}.mock-shell{display:grid;grid-template-columns:126px 1fr;min-height:390px}.mock-sidebar{background:#f7f7f8;border-right:1px solid #ececed;padding:16px 10px}.mock-logo{font-size:12px;font-weight:900;margin-bottom:24px}.mock-logo i{font-style:normal;background:#ff4438;color:#fff;border-radius:5px;padding:4px 5px;margin-right:5px}.mock-nav{display:flex;gap:8px;align-items:center;padding:9px 8px;border-radius:7px;color:#85858d;font-size:9px;margin-bottom:3px}.mock-nav.active{background:#fff;color:#18181b;border:1px solid #e8e8ea;font-weight:700}.mock-separator{height:18px}.mock-main{padding:20px;background:#fff}.mock-top{display:flex;justify-content:space-between;align-items:center}.mock-top small{display:block;color:#a1a1aa;font:600 8px 'Roboto Mono',monospace}.mock-top strong{font-size:21px;letter-spacing:-.04em}.mock-top button{border:0;background:#ff4438;color:#fff;border-radius:6px;padding:8px 10px;font-size:9px;font-weight:700}.mock-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:18px 0}.mock-stats>div{border:1px solid #e8e8ea;border-radius:8px;padding:10px}.mock-stats small,.mock-stats em{display:block;color:#a1a1aa;font-size:8px;font-style:normal}.mock-stats strong{display:block;font-size:16px;margin:4px 0}.mock-stats em{color:#16a34a}.mock-panel{border:1px solid #e8e8ea;border-radius:9px}.mock-panel-head{display:flex;justify-content:space-between;padding:11px 12px;border-bottom:1px solid #eee;font-size:10px}.mock-panel-head span{color:#ff4438}.mock-appointment{display:grid;grid-template-columns:39px 24px 1fr auto;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #f1f1f2;font-size:9px}.mock-appointment:last-child{border:0}.mock-appointment>b{font:700 9px 'Roboto Mono',monospace}.mock-avatar{width:24px;height:24px;border-radius:6px;background:#fce4e2;display:grid;place-items:center;font-size:7px;font-weight:800}.mock-avatar.second{background:#e7eefc}.mock-avatar.third{background:#eaf6ec}.mock-appointment div strong,.mock-appointment div small{display:block}.mock-appointment div small{color:#a1a1aa;margin-top:2px}.mock-appointment mark{background:none;font-weight:700
  }

  .trust-icon {
  width: 20px;
  height: 20px;
  }

  .trust-inner {
    height:70px;
    display:flex;
    align-items:center;
    justify-content:space-between;
    font:700 32px 'Roboto Mono',monospace;
    color:#a1a1aa
  }
  .trust-inner b {
    color:#141313
  }
  .section-space {
    padding-top:105px
  }
  .workflow .section-heading,.product-section .section-heading,.pricing .section-heading {
    display:flex;
    justify-content:space-between;
    align-items:end;
    margin:15px 0 38px
  }
  .section-heading h2 {
    font-size:clamp(35px,4.3vw,55px);
    line-height:1.02;
    letter-spacing:-.06em;
    margin:0
  }

  .arrow-icon {
    width: 18px;
    height: 18px;
    margin-left: auto;
    margin-top: auto;
  }
  .section-heading p {
    max-width:400px;
    color:#71717a;
    line-height:1.2;
    font-size:14px }
    .workflow-grid{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #e8e8ea;border-radius:13px;overflow:hidden;background:#fff}.workflow-card{display:flex;flex-direction:column;min-height:250px;padding:23px;border-right:1px solid #e8e8ea;position:relative}.workflow-card:last-child{border:0}.workflow-num{font:700 30px 'Roboto Mono',monospace;color:#0f0f0f}.workflow-label{display:block;margin-top:34px;font:700 16px 'Roboto Mono',monospace;color:#ff4438}.workflow-card h3{font-size:18px;line-height:1.15;letter-spacing:-.03em;margin:9px 0}.workflow-card p,.feature-card p{color:#71717a;font-size:16px;line-height:1.2}.workflow-arrow{position:absolute;right:22px;bottom:21px;font-size:18px;color:#a1a1aa}.feature-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}

.feature-card:nth-child(1) { grid-column: span 2; }
.feature-card:nth-child(2) { grid-column: span 1; }
.feature-card:nth-child(3) { grid-column: span 1; }
.feature-card:nth-child(4) { grid-column: span 2; }.feature-grid{display:grid;grid-template-columns:1.35fr .65fr;gap:14px}.feature-card{display: flex; flex-direction: column; justify-content: space-between; border:1px solid #e8e8ea;border-radius:13px;background:#fff;padding:20px;min-height:265px}.feature-copy{ display: flex; flex-direction: column; justify-content: space-between; height: 100%;
} .feature-copy > span{font:700 24px 'Roboto Mono',monospace;color:#909096}.feature-text > h3 { min-width: 100%}.feature-card >span{font:700 24px 'Roboto Mono',monospace;color:#909096}.feature-card h3{font-size:28px;line-height:1;letter-spacing:-.045em;margin:15px 0 8px;max-width:390px}.feature-large {
  display: grid;
  grid-template-columns: 1fr 1fr;
  justify-content: space-between;
  gap: 30px;
  grid-row: span 2;
}.feature-dark{background:#18181b;color:#fff;border-color:#18181b}.feature-dark p{color:#a1a1aa}.calendar-mock{ border:1px solid #ececed;border-radius:9px;align-self:right;overflow:hidden}.calendar-row{display:grid;grid-template-columns:52px 1fr;gap:10px;padding:11px;border-bottom:1px solid #f0f0f1}.calendar-row:last-child{border:0}.calendar-row>b{font:700 12px 'Roboto Mono',monospace;color:#a1a1aa}.calendar-row strong,.calendar-row small{display:block;font-size:12px}.calendar-row small{color:#a1a1aa;margin-top:2px}.mini-client{margin-top:35px;border:1px solid #ececed;border-radius:9px;padding:12px;display:flex;align-items:center;gap:9px}.mini-client>span,.team-dots i{width:45px;height:45px;border-radius:8px;background:#fce4e2;display:grid;place-items:center;font-size:12px;font-style:normal;font-weight:800}.mini-client div{flex:1}.mini-client strong,.mini-client small{display:block;font-size:14px}.mini-client small{color:#a1a1aa;margin-top:3px}.mini-client>b{color:#a1a1aa}.team-dots{display:flex;margin-top:35px}.team-dots i{margin-right:-5px;border:2px solid #fff;background:#e7eefc}.team-dots i:nth-child(3){background:#eaf6ec}.team-dots i:last-child{background:#f4f4f5}.growth-stat{margin-top:28px;display:flex;align-items:baseline;gap:10px}.growth-stat strong{font-size:72px;letter-spacing:-.06em;color:#ff6a5f}.growth-stat small{color:#a1a1aa}.ai-card{background:#18181b;color:#fff;border-radius:14px;padding:55px;display:grid;grid-template-columns:1fr 1fr;gap:70px;overflow:hidden;position:relative}.ai-copy h2{font-size:42px;line-height:1.05;letter-spacing:-.055em;margin:18px 0}.ai-copy h2 span{color:#ff6a5f}.ai-copy p{color:#a1a1aa;line-height:1.65;font-size:14px;max-width:480px}.text-link{display:inline-block;color:#fff;font-weight:700;margin-top:14px}.ai-panel{border:1px solid #35353a;background:#202023;border-radius:11px;padding:18px;align-self:center}.ai-header{display:flex;gap:10px;padding-bottom:14px;border-bottom:1px solid #35353a}.ai-badge{background:#ff4438;color:#fff;font:700 9px 'Roboto Mono',monospace;padding:6px 7px;border-radius:5px}.ai-header strong,.ai-header small{display:block;font-size:10px}.ai-header small{color:#85858d;margin-top:3px}.ai-item{display:grid;grid-template-columns:43px 1fr 15px;gap:10px;align-items:center;padding:14px 0;border-bottom:1px solid #35353a}.ai-item:last-child{border:0}.ai-item>b{font:700 13px 'Roboto Mono',monospace;color:#ff6a5f}.ai-item strong,.ai-item small{display:block;font-size:10px}.ai-item small{color:#85858d;margin-top:3px}.ai-item span{color:#85858d}.pricing-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.pricing-two{grid-template-columns:repeat(3,minmax(0,420px));justify-content:center}.price-card{border:1px solid #e8e8ea;background:#fff;border-radius:13px;padding:27px;position:relative;display:flex;flex-direction:column;min-height:370px}.price-card.popular{border:1px solid #ff4438}.popular-badge{position:absolute;right:18px;top:18px;background:#ff4438;color:#fff;font:700 8px 'Roboto Mono',monospace;padding:6px 8px;border-radius:5px}.price-card>span{font:700 10px 'Roboto Mono',monospace;color:#71717a}.price-card>strong{font-size:38px;letter-spacing:-.05em;margin-top:18px}.price-card>strong small{font-size:11px;color:#a1a1aa;letter-spacing:0}.price-card>p{font-size:12px;color:#a1a1aa;margin:6px 0 20px}.price-card ul{list-style:none;padding:0;margin:0 0 24px;color:#52525b;font-size:12px;line-height:2.1}.price-primary,.price-secondary{margin-top:auto}.final-cta{display:flex;justify-content:space-between;align-items:center;border-top:1px solid #e8e8ea}.final-cta>div>span{font:700 9px 'Roboto Mono',monospace;color:#a1a1aa}.final-cta h2{font-size:clamp(38px,5vw,65px);line-height:.98;letter-spacing:-.06em;margin:17px 0}.final-cta h2 em{color:#ff4438;font-style:normal}.final-cta p{color:#71717a;font-size:14px}.landing-footer{margin-top:105px;border-top:1px solid #e8e8ea}.footer-inner{min-height:110px;display:flex;align-items:center;justify-content:space-between;color:#a1a1aa;font-size:11px}.footer-inner small{display:block;margin-top:5px}.footer-links{display:flex;gap:22px}.footer-links a:hover{color:#18181b}
@media(max-width:900px){.hero{grid-template-columns:1fr;padding-top:65px}.hero-product{transform:none}.workflow-grid{grid-template-columns:1fr 1fr}.workflow-card:nth-child(2){border-right:0}.workflow-card:nth-child(-n+2){border-bottom:1px solid #e8e8ea}.feature-grid{grid-template-columns:1fr}.feature-large{grid-template-columns:1fr;grid-row:auto}.ai-card{grid-template-columns:1fr;gap:30px;padding:35px}.pricing-grid,.pricing-two{grid-template-columns:1fr}.price-card{min-height:0}.final-cta{align-items:flex-start;gap:30px;flex-direction:column}}
@media(max-width:640px){.section-wrap,.landing-nav{width:min(100% - 28px,1180px)}.landing-nav{height:64px}.landing-links{display:none;position:absolute;left:14px;right:14px;top:60px;background:#fff;border:1px solid #e8e8ea;border-radius:10px;padding:10px;flex-direction:column;align-items:stretch;z-index:20;box-shadow:0 16px 40px -25px rgba(0,0,0,.3)}.landing-links.open{display:flex}.landing-links a{padding:11px}.mobile-menu{display:block}.hero{padding:55px 0 70px}.hero h1{font-size:49px}.hero-subtitle{font-size:16px}.hero-actions{flex-direction:column;align-items:stretch}.hero-proof{flex-wrap:wrap}.mock-shell{grid-template-columns:1fr}.mock-sidebar{display:none}.mock-stats{grid-template-columns:1fr}.mock-main{padding:13px}.trust-inner{overflow:hidden;gap:24px;justify-content:flex-start;white-space:nowrap}.workflow-grid{grid-template-columns:1fr}.workflow-card{border-right:0!important;border-bottom:1px solid #e8e8ea!important}.workflow-card:last-child{border-bottom:0!important}.workflow .section-heading,.product-section .section-heading,.pricing .section-heading{display:block}.section-heading p{margin-top:18px}.feature-card{padding:20px}.ai-copy h2{font-size:34px}.ai-card{padding:26px}.final-cta h2{font-size:42px}.footer-inner{align-items:flex-start;flex-direction:column;padding:25px 0;gap:20px}.footer-links{flex-wrap:wrap}}
</style>
