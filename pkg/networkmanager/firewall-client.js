/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

import cockpit from 'cockpit';
import * as service from 'service';

var firewall = {
    installed: true,
    enabled: false,
    readonly: true,
    services: {},
    enabledServices: new Set(),
    zones: {}
};

cockpit.event_target(firewall);

const firewalld_service = service.proxy('firewalld');
var firewalld_dbus = null;

function initFirewalldDbus() {
    firewalld_dbus = cockpit.dbus('org.fedoraproject.FirewallD1', { superuser: "try" });

    firewalld_dbus.addEventListener('owner', (event, owner) => {
        firewall.enabled = !!owner;

        firewall.services = {};
        firewall.enabledServices = new Set();
        console.log('firewall.enabledServices first', firewall.enabledServices);

        if (!firewall.enabled) {
            firewall.dispatchEvent('changed');
            return;
        }

        firewall.getAvailableZones()
                .then(zones => (
                    Promise.all(zones.map(zone => (
                        fetchZoneInfos(zone).then(reply => {
                            firewall.zones[zone] = { ...reply, name: zone };
                        })
                    )))
                ))
                .then(() => {
                    Object.keys(firewall.zones).map(key => {
                        const services = firewall.zones[key].services;

                        fetchServiceInfos(services)
                                .then(services => services.map(s => firewall.enabledServices.add(s.id)))
                                .then(() => {
                                    firewall.dispatchEvent('changed');
                                });
                    });
                })
                .then(() => console.log('firewall.enabledServices second', firewall.enabledServices))
                .catch(error => console.warn(error));
    });

    firewalld_dbus.subscribe({
        interface: 'org.fedoraproject.FirewallD1.zone',
        path: '/org/fedoraproject/FirewallD1',
        member: 'ServiceAdded'
    }, (path, iface, signal, args) => {
        const service = args[1];

        firewall.getAvailableZones()
                .then(zones => (
                    Promise.all(zones.map(zone => (
                        fetchZoneInfos(zone).then(reply => {
                            firewall.zones[zone] = { ...reply, name: zone };
                        })
                    )))
                ))
                .then(() => {
                    fetchServiceInfos([service], true).then(info => {
                        firewall.enabledServices.add(info[0].id);
                        firewall.dispatchEvent('changed');
                    });
                })
                .catch(error => console.warn(error));
    });

    firewalld_dbus.subscribe({
        interface: 'org.fedoraproject.FirewallD1.zone',
        path: '/org/fedoraproject/FirewallD1',
        member: 'ServiceRemoved'
    }, (path, iface, signal, args) => {
        const service = args[1];

        firewall.enabledServices.delete(service);
        firewall.getAvailableZones()
                .then(zones => (
                    Promise.all(zones.map(zone => (
                        fetchZoneInfos(zone).then(reply => {
                            firewall.zones[zone] = { ...reply, name: zone };
                        })
                    )))
                ))
                .then(() => {
                    return firewall.dispatchEvent('changed');
                })
                .catch(error => console.warn(error));
    });

    firewalld_dbus.subscribe({
        interface: 'org.fedoraproject.FirewallD1.zone',
        path: '/org/fedoraproject/FirewallD1',
        member: 'InterfaceAdded'
    }, () => {
        firewall.getAvailableZones()
                .then(zones => (
                    Promise.all(zones.map(zone => (
                        fetchZoneInfos(zone).then(reply => {
                            firewall.zones[zone] = { ...reply, name: zone };
                            firewall.dispatchEvent('changed');
                        })
                    )))
                ))
                .catch(error => console.warn(error));
    });

    firewalld_dbus.subscribe({
        interface: 'org.fedoraproject.FirewallD1.zone',
        path: '/org/fedoraproject/FirewallD1',
        member: 'InterfaceRemoved'
    }, () => {
        firewall.getAvailableZones()
                .then(zones => (
                    Promise.all(zones.map(zone => (
                        fetchZoneInfos(zone).then(reply => {
                            firewall.zones[zone] = { ...reply, name: zone };
                            firewall.dispatchEvent('changed');
                        })
                    )))
                ))
                .catch(error => console.warn(error));
    });
}

firewalld_service.addEventListener('changed', () => {
    let installed = !!firewalld_service.exists;

    /* HACK: cockpit.dbus() remains dead for non-activatable names, so reinitialize it if the service gets enabled and started
     * See https://github.com/cockpit-project/cockpit/pull/9125 */
    if (!firewall.enabled && firewalld_service.state == 'running')
        initFirewalldDbus();

    if (firewall.installed == installed)
        return;

    firewall.installed = installed;
    firewall.dispatchEvent('changed');
});

function fetchServiceInfos(services, forceUpdate) {
    // We can't use Promise.all() here until cockpit is able to dispatch es2015 promises
    // https://github.com/cockpit-project/cockpit/issues/10956
    console.log('fetchServiceInfos');
    // eslint-disable-next-line cockpit/no-cockpit-all
    var promises = cockpit.all(services.map(service => {
        if (firewall.services[service] && !forceUpdate)
            return firewall.services[service];

        return firewalld_dbus.call('/org/fedoraproject/FirewallD1',
                                   'org.fedoraproject.FirewallD1',
                                   'getServiceSettings', [service])
                .then(reply => {
                    const [ , name, description, ports ] = reply[0];

                    let info = {
                        id: service,
                        name: name,
                        zones: firewall.getZonesByService(service),
                        description: description,
                        ports: ports.map(p => ({ port: p[0], protocol: p[1] }))
                    };

                    firewall.services[service] = info;
                    return info;
                });
    }));

    /*
     * Work around `cockpit.all()` returning results in individual arguments -
     * that's just confusing and doesn't work with ES6 style functions.
     */
    return promises.then(function () {
        return Array.prototype.slice.call(arguments);
    });
}

function fetchZoneInfos(zoneName) {
    return Promise.all([
        firewalld_dbus.call(
            '/org/fedoraproject/FirewallD1',
            'org.fedoraproject.FirewallD1.zone',
            'getServices',
            [zoneName]
        ),
        firewalld_dbus.call(
            '/org/fedoraproject/FirewallD1/config',
            'org.fedoraproject.FirewallD1.config',
            'getZoneByName',
            [zoneName]
        ),
        firewalld_dbus.call(
            '/org/fedoraproject/FirewallD1',
            'org.fedoraproject.FirewallD1.zone',
            'getInterfaces',
            [zoneName]
        )
    ]).then(reply => {
        const services = reply[0][0];
        const path = reply[1][0];
        const interfaces = reply[2][0];

        return { services, path, interfaces };
    });
}

initFirewalldDbus();

cockpit.spawn(['sh', '-c', 'pkcheck --action-id org.fedoraproject.FirewallD1.all --process $$ --allow-user-interaction 2>&1'])
        .done(() => {
            firewall.readonly = false;
            firewall.dispatchEvent('changed');
        });

firewall.enable = () => Promise.all([firewalld_service.enable(), firewalld_service.start()]);

firewall.disable = () => Promise.all([firewalld_service.stop(), firewalld_service.disable()]);

firewall.getAvailableServices = () => {
    return firewalld_dbus.call('/org/fedoraproject/FirewallD1',
                               'org.fedoraproject.FirewallD1',
                               'listServices', [])
            .then(reply => fetchServiceInfos(reply[0]))
            .catch(error => console.warn(error));
};

firewall.getAvailableZones = () => {
    return firewalld_dbus.call('/org/fedoraproject/FirewallD1',
                               'org.fedoraproject.FirewallD1.zone',
                               'getZones', [])
            .then(reply => reply[0])
            .catch(error => console.warn(error));
};

function getDefaultZonePath() {
    return firewalld_dbus.call('/org/fedoraproject/FirewallD1',
                               'org.fedoraproject.FirewallD1',
                               'getDefaultZone', [])
            .then(reply => firewalld_dbus.call('/org/fedoraproject/FirewallD1/config',
                                               'org.fedoraproject.FirewallD1.config',
                                               'getZoneByName', [reply[0]]))
            .then(reply => reply[0]);
}

/*
 * Remove a service from the default zone (i.e., close its ports).
 *
 * Returns a promise that resolves when the service is removed.
 */
firewall.removeService = (service) => {
    Promise.all(firewall.services[service].zones.map(zone => {
        const zoneName = zone.name;
        const zonePath = firewall.zones[zoneName].path;

        return firewalld_dbus.call('/org/fedoraproject/FirewallD1',
                                   'org.fedoraproject.FirewallD1.zone',
                                   'removeService', [zoneName || '', service])
                .then(reply => zonePath || getDefaultZonePath())
                .then(path => firewalld_dbus.call(path, 'org.fedoraproject.FirewallD1.config.zone', 'removeService', [service]))
                .catch(error => console.warn('removeService', error));
    }));
};

/*
 * Add a predefined firewalld service to the default zone (i.e., open its
 * ports).
 *
 * Returns a promise that resolves when the service is added.
 */
firewall.addService = (service, zonePath, zoneName) => {
    return firewalld_dbus.call('/org/fedoraproject/FirewallD1',
                               'org.fedoraproject.FirewallD1.zone',
                               'addService',
                               [zoneName || '', service, 0])
            .then(reply => zonePath || getDefaultZonePath())
            .then(path => firewalld_dbus.call(path, 'org.fedoraproject.FirewallD1.config.zone',
                                              'addService', [service]))
            .catch(error => console.warn(error));
};

/*
 * Like addService(), but adds multiple predefined firewalld services at once
 * to the default zone.
 *
 * Returns a promise that resolves when all services are added.
 */
firewall.addServices = ({ services, zones }) => {
    if (!zones || zones.length === 0) {
        return Promise.all(services.map(service => firewall.addService(service)));
    }

    return Promise.all(
        zones.map(
            zoneName => {
                return firewalld_dbus.call(
                    '/org/fedoraproject/FirewallD1/config',
                    'org.fedoraproject.FirewallD1.config',
                    'getZoneByName',
                    [zoneName]
                ).then(zonePath => {
                    return Promise.all(services.map(service => firewall.addService(service, zonePath[0], zoneName)));
                });
            }
        )
    );
};

firewall.addInterfaceToZone = (interfaceName, zoneName, zonePath) => {
    firewalld_dbus.call(
        '/org/fedoraproject/FirewallD1',
        'org.fedoraproject.FirewallD1.zone',
        'addInterface',
        [zoneName, interfaceName]
    ).then(() => firewalld_dbus.call(
        zonePath,
        'org.fedoraproject.FirewallD1.config.zone',
        'addInterface',
        [interfaceName])
    );
};

firewall.removeInterfaceFromZone = (interfaceName, zoneName, zonePath) => {
    firewalld_dbus.call(
        '/org/fedoraproject/FirewallD1',
        'org.fedoraproject.FirewallD1.zone',
        'removeInterface',
        [zoneName, interfaceName]
    ).then(() => firewalld_dbus.call(
        zonePath,
        'org.fedoraproject.FirewallD1.config.zone',
        'removeInterface',
        [interfaceName])
    );
};

firewall.getZonesByService = (service) => {
    const zones = Object.keys(firewall.zones);

    return zones.map(
        key => {
            const zone = firewall.zones[key];
            const servicesInZone = zone.services;

            if (!servicesInZone.includes(service)) {
                return;
            }

            return zone;
        }
    ).filter(zone => Boolean(zone));
};

export default firewall;
