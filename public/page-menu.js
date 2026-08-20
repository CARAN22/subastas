(function () {
    const params = new URLSearchParams(window.location.search);
    if (params.get('menu') === '0') return;

    const links = [
        { label: 'Panel principal', href: '/index.html' },
        { label: 'Overlay eliminacion', href: '/overlay.html' },
        { label: 'Overlay clasico', href: '/auction.html' },
        { label: 'Subasta clasica', href: '/classic.html' },
        { label: 'Likes', href: '/likes.html' },
        { label: 'Top donadores', href: '/donors.html' },
        { label: 'Premios live', href: '/prizes.html' },
        { label: 'Batalla', href: '/battle.html' },
        { label: 'Batalla control', href: '/battle.html?control=1' },
        { label: 'Batalla Live Studio', href: '/battle-overlay.html' },
        { label: 'Batalla OBS limpio', href: '/battle.html?clean=1' },
        { label: 'Wins con controles', href: '/wins.html?control=1' },
        { label: 'Wins OBS limpio', href: '/wins.html' },
        { label: 'Comentarios control', href: '/comments.html?control=1' },
        { label: 'Comentarios voz', href: '/comments.html?voice=1' }
    ];

    const styles = `
        #global-page-menu-root {
            position: fixed;
            top: 16px;
            right: 16px;
            z-index: 2147483000;
            color: #fff;
            font-family: "Segoe UI", Roboto, Arial, sans-serif;
            pointer-events: none;
        }

        #global-page-menu-root,
        #global-page-menu-root * {
            box-sizing: border-box;
        }

        #gpm-toggle {
            all: unset;
            width: 46px;
            height: 46px;
            display: grid;
            place-items: center;
            border: 2px solid #bc13fe;
            border-radius: 8px;
            background: rgba(0, 0, 0, 0.92);
            box-shadow: 0 0 20px rgba(188, 19, 254, 0.46);
            cursor: pointer;
            pointer-events: auto;
        }

        #gpm-toggle:hover,
        #gpm-toggle:focus-visible {
            box-shadow: 0 0 28px rgba(188, 19, 254, 0.7);
            outline: none;
        }

        #gpm-toggle-lines {
            width: 22px;
            display: grid;
            gap: 5px;
        }

        #gpm-toggle-lines span {
            height: 3px;
            border-radius: 999px;
            background: #fff;
            box-shadow: 0 0 8px rgba(255, 255, 255, 0.38);
        }

        #gpm-backdrop {
            position: fixed;
            inset: 0;
            z-index: 2147482998;
            display: none;
            background: rgba(0, 0, 0, 0.36);
            pointer-events: auto;
        }

        #global-page-menu-root.gpm-open #gpm-backdrop {
            display: block;
        }

        #gpm-panel {
            position: fixed;
            top: 70px;
            right: 16px;
            z-index: 2147482999;
            width: min(330px, calc(100vw - 32px));
            max-height: calc(100vh - 88px);
            overflow: auto;
            display: none;
            padding: 16px;
            border: 2px solid #bc13fe;
            border-radius: 8px;
            background: rgba(0, 0, 0, 0.96);
            box-shadow: 0 0 30px rgba(188, 19, 254, 0.44), 0 18px 40px rgba(0, 0, 0, 0.72);
            pointer-events: auto;
        }

        #global-page-menu-root.gpm-open #gpm-panel {
            display: block;
        }

        #gpm-title {
            margin: 0 0 12px;
            color: #fff;
            font-size: 0.92rem;
            font-weight: 1000;
            line-height: 1;
            text-transform: uppercase;
        }

        #gpm-links {
            display: grid;
            gap: 8px;
        }

        .gpm-link {
            min-height: 42px;
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            align-items: center;
            gap: 10px;
            padding: 10px 12px;
            border: 1px solid rgba(255, 255, 255, 0.25);
            border-radius: 8px;
            background: #151515;
            color: #fff;
            text-decoration: none;
        }

        .gpm-link:hover,
        .gpm-link:focus-visible,
        .gpm-link.gpm-active {
            border-color: #bc13fe;
            box-shadow: 0 0 16px rgba(188, 19, 254, 0.58);
            outline: none;
        }

        .gpm-link span {
            overflow: hidden;
            color: #fff;
            font-size: 0.86rem;
            font-weight: 1000;
            line-height: 1.15;
            text-overflow: ellipsis;
        }

        .gpm-link code {
            color: #ffea00;
            font-family: Consolas, "Courier New", monospace;
            font-size: 0.72rem;
            font-weight: 1000;
            white-space: nowrap;
        }

        @media (max-width: 520px) {
            #global-page-menu-root {
                top: 10px;
                right: 10px;
            }

            #gpm-panel {
                top: 62px;
                right: 10px;
                width: calc(100vw - 20px);
                max-height: calc(100vh - 74px);
            }
        }
    `;

    function isActive(href) {
        const target = new URL(href, window.location.origin);
        if (target.pathname !== window.location.pathname) return false;
        if (!target.search) return !window.location.search;
        return target.search === window.location.search;
    }

    function renderMenu() {
        if (document.getElementById('global-page-menu-root')) return;

        const style = document.createElement('style');
        style.id = 'global-page-menu-style';
        style.textContent = styles;
        document.head.appendChild(style);

        const root = document.createElement('div');
        root.id = 'global-page-menu-root';
        root.innerHTML = `
            <button id="gpm-toggle" type="button" aria-label="Abrir menu de paginas" aria-expanded="false">
                <span id="gpm-toggle-lines" aria-hidden="true"><span></span><span></span><span></span></span>
            </button>
            <div id="gpm-backdrop" aria-hidden="true"></div>
            <nav id="gpm-panel" aria-label="Paginas y overlays">
                <h2 id="gpm-title">Entrar a paginas</h2>
                <div id="gpm-links">
                    ${links.map((link) => `
                        <a class="gpm-link${isActive(link.href) ? ' gpm-active' : ''}" href="${link.href}" target="_blank" rel="noopener">
                            <span>${link.label}</span>
                            <code>${link.href}</code>
                        </a>
                    `).join('')}
                </div>
            </nav>
        `;
        document.body.appendChild(root);

        const toggle = root.querySelector('#gpm-toggle');
        const backdrop = root.querySelector('#gpm-backdrop');

        function setOpen(open) {
            root.classList.toggle('gpm-open', open);
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        }

        toggle.addEventListener('click', () => {
            setOpen(!root.classList.contains('gpm-open'));
        });

        backdrop.addEventListener('click', () => setOpen(false));

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') setOpen(false);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', renderMenu, { once: true });
    } else {
        renderMenu();
    }
})();
