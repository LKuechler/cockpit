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

import cockpit from "cockpit";
import React from "react";
import ReactDOM from "react-dom";
import {
    Button,
    Modal,
    OverlayTrigger,
    Tooltip
} from "patternfly-react";

import firewall from "./firewall-client.js";
import { Listing, ListingRow } from "cockpit-components-listing.jsx";
import { OnOffSwitch } from "cockpit-components-onoff.jsx";

import "page.css";
import "table.css";
import "./networking.css";

const _ = cockpit.gettext;

function EmptyState(props) {
    return (
        <div className="curtains-ct blank-slate-pf">
            {props.icon && <div className={"blank-slate-pf-icon " + props.icon} />}
            <h1>{props.title}</h1>
            {props.children}
        </div>
    );
}

function ServiceRow(props) {
    if (!props.service.name)
        return <ListingRow key={props.service.id} columns={["", "", ""]} />;

    var tcp = props.service.ports.filter(p => p.protocol.toUpperCase() == 'TCP');
    var udp = props.service.ports.filter(p => p.protocol.toUpperCase() == 'UDP');

    function onRemoveService(event) {
        if (event.button !== 0)
            return;

        props.onRemoveService(props.service.id);
        event.stopPropagation();
    }

    var deleteButton;
    if (props.readonly) {
        deleteButton = (
            <OverlayTrigger className="pull-right" placement="top"
                            overlay={ <Tooltip id="tip-auth">{ _("You are not authorized to modify the firewall.") }</Tooltip> } >
                <button className="btn btn-danger pficon pficon-delete" disabled />
            </OverlayTrigger>
        );
    } else {
        deleteButton = <button className="btn btn-danger pficon pficon-delete" onClick={onRemoveService} />;
    }

    var columns = [
        { name: props.service.name, header: true },
        <div>
            { tcp.map(p => p.port).join(', ') }
        </div>,
        <div>
            { udp.map(p => p.port).join(', ') }
        </div>,
        deleteButton
    ];

    var tabs = [
        { name: _("Details"), renderer: () => <p>{props.service.description}</p> },
        { name: _("Zones"), renderer: () => (
            <ul>
                {props.service.zones.map(zone => {
                    return (
                        <li key={zone.name}>
                            {zone.name}
                        </li>
                    );
                })}
            </ul>
        ) }
    ];

    return <ListingRow key={props.service.id}
                       rowId={props.service.id}
                       columns={columns}
                       tabRenderers={tabs} />;
}

class SearchInput extends React.Component {
    constructor() {
        super();

        this.onValueChanged = this.onValueChanged.bind(this);
    }

    onValueChanged(event) {
        let value = event.target.value;

        if (this.timer)
            window.clearTimeout(this.timer);

        this.timer = window.setTimeout(() => {
            this.props.onChange(value);
            this.timer = null;
        }, 300);
    }

    render() {
        return <input id={this.props.id}
                      className={this.props.className}
                      onChange={this.onValueChanged} />;
    }
}

class AddServicesBody extends React.Component {
    constructor() {
        super();

        this.state = {
            services: null,
            zones: null,
            selected: new Set(),
            selectedZones: new Set(),
            filter: ""
        };

        this.save = this.save.bind(this);
        this.onFilterChanged = this.onFilterChanged.bind(this);
        this.onToggleService = this.onToggleService.bind(this);
        this.onToggleZone = this.onToggleZone.bind(this);
    }

    save() {
        firewall.addServices({ services: [...this.state.selected], zones: [...this.state.selectedZones] });
        this.props.close();
    }

    componentDidMount() {
        this.setState({ zones: firewall.zones });
        firewall.getAvailableServices()
                .then(services => this.setState({ services: services }));
    }

    onFilterChanged(value) {
        this.setState({ filter: value.toLowerCase() });
    }

    onToggleService(event) {
        var service = event.target.getAttribute("data-id");
        var enabled = event.target.checked;

        this.setState(oldState => {
            let selected = new Set(oldState.selected);

            if (enabled)
                selected.add(service);
            else
                selected.delete(service);

            return {
                selected: selected
            };
        });
    }

    onToggleZone(event) {
        var zone = event.target.getAttribute("data-id");
        var enabled = event.target.checked;

        this.setState(oldState => {
            let selectedZones = new Set(oldState.selectedZones);

            if (enabled)
                selectedZones.add(zone);
            else
                selectedZones.delete(zone);

            return {
                selectedZones: selectedZones
            };
        });
    }

    render() {
        let services;
        if (this.state.filter && this.state.services)
            services = this.state.services.filter(s => s.name.toLowerCase().indexOf(this.state.filter) > -1);
        else
            services = this.state.services;

        // hide already enabled services
        if (services)
            services = services.filter(s => !firewall.enabledServices.has(s.id));

        let body;
        if (this.state.services) {
            body = (
                <Modal.Body id="add-services-dialog">
                    <table className="form-table-ct">
                        <tbody>
                            <tr>
                                <td>
                                    <label htmlFor="filter-services-input" className="control-label">
                                        {_("Filter Services")}
                                    </label>
                                </td>
                                <td>
                                    <SearchInput id="filter-services-input"
                                                 className="form-control"
                                                 onChange={this.onFilterChanged} />
                                </td>
                            </tr>
                        </tbody>
                    </table>
                    <ul className="list-group dialog-list-ct">
                        {
                            services.map(s => (
                                <li key={s.id} className="list-group-item">
                                    <label>
                                        <input data-id={s.id}
                                               type="checkbox"
                                               checked={this.state.selected.has(s.id)}
                                               onChange={this.onToggleService} />
                                        &nbsp;
                                        <span>{s.name}</span>
                                    </label>
                                </li>
                            ))
                        }
                    </ul>
                    <table className="form-table-ct">
                        <tbody>
                            <tr>
                                <td>
                                    <label htmlFor="filter-zones-input" className="control-label">
                                        {_("Filter Zones")}
                                    </label>
                                </td>
                                <td>
                                    <SearchInput id="filter-zones-input"
                                                 className="form-control"
                                                 onChange={this.onZonesFilterChanged} />
                                </td>
                            </tr>
                        </tbody>
                    </table>
                    <ul className="list-group dialog-list-ct">
                        {
                            this.state.zones && Object.keys(this.state.zones).map(key => {
                                const zone = this.state.zones[key];

                                if (!zone.interfaces.length) {
                                    return;
                                }

                                return (
                                    <li key={zone.name} className="list-group-item">
                                        <label>
                                            <input data-id={zone.name}
                                                type="checkbox"
                                                checked={this.state.selectedZones.has(zone.name)}
                                                onChange={this.onToggleZone} />
                                            &nbsp;
                                            <span>{zone.name}</span>
                                        </label>
                                    </li>
                                );
                            })
                        }
                    </ul>
                </Modal.Body>
            );
        } else {
            body = (
                <Modal.Body id="add-services-dialog">
                    <div className="spinner spinner-lg" />
                </Modal.Body>
            );
        }

        return (
            <Modal id="add-services-dialog" show onHide={this.props.close}>
                <Modal.Header>
                    <Modal.Title> {`Add Services`} </Modal.Title>
                </Modal.Header>
                <div id="cockpit_modal_dialog">
                    {body}
                </div>
                <Modal.Footer>
                    <Button bsStyle='default' className='btn-cancel' onClick={this.props.close}>
                        {_("Cancel")}
                    </Button>
                    <Button bsStyle='primary' onClick={this.save}>
                        {_("Add Services")}
                    </Button>
                </Modal.Footer>
            </Modal>
        );
    }
}

class ZonesBody extends React.Component {
    constructor() {
        super();

        this.state = {
            selectedInterfaces: new Set(),
            allInterfaces: []
        };

        this.save = this.save.bind(this);
        this.onToggleInterface = this.onToggleInterface.bind(this);
    }

    componentDidMount() {
        this.setState({ selectedInterfaces: new Set(this.props.zone.interfaces) });
        cockpit.spawn(['sh', '-c', 'ip -json link'])
                .done(reply => {
                    const interfaces = JSON.parse(reply);
                    this.setState({
                        allInterfaces: interfaces.map(interfaceItem => interfaceItem.ifname)
                    });
                });
    }

    save() {
        this.props.zone.interfaces.forEach(existingInterface => {
            if (this.state.selectedInterfaces.has(existingInterface)) {
                return;
            }

            firewall.removeInterfaceFromZone(existingInterface, this.props.zone.name, this.props.zone.path);
        });

        this.state.selectedInterfaces.forEach(selectedInterface => {
            if (this.props.zone.interfaces.includes(selectedInterface)) {
                return;
            }

            firewall.addInterfaceToZone(selectedInterface, this.props.zone.name, this.props.zone.path);
        });

        this.props.close();
    }

    onToggleInterface(event) {
        var interfaceId = event.target.getAttribute("data-id");
        var enabled = event.target.checked;

        this.setState(oldState => {
            let selectedInterfaces = new Set(oldState.selectedInterfaces);

            if (enabled)
                selectedInterfaces.add(interfaceId);
            else
                selectedInterfaces.delete(interfaceId);

            return {
                selectedInterfaces
            };
        });
    }

    render() {
        return (
            <Modal id="add-services-dialog" show onHide={this.props.close}>
                <Modal.Header>
                    <Modal.Title> {this.props.zone.name} </Modal.Title>
                </Modal.Header>
                <div id="cockpit_modal_dialog">
                    <Modal.Body id="add-services-dialog">
                        <ul className="list-group dialog-list-ct">
                            {
                                this.state.allInterfaces.map(interfaceItem => (
                                    <li key={interfaceItem} className="list-group-item">
                                        <label>
                                            <input data-id={interfaceItem}
                                                type="checkbox"
                                                checked={this.state.selectedInterfaces.has(interfaceItem)}
                                                onChange={this.onToggleInterface} />
                                            &nbsp;
                                            <span>{interfaceItem}</span>
                                        </label>
                                    </li>
                                ))
                            }
                        </ul>
                    </Modal.Body>
                </div>
                <Modal.Footer>
                    <Button bsStyle='default' className='btn-cancel' onClick={this.props.close}>
                        {_("Cancel")}
                    </Button>
                    <Button bsStyle='primary' onClick={this.save}>
                        {_("Save Interfaces")}
                    </Button>
                </Modal.Footer>
            </Modal>
        );
    }
}

export class Firewall extends React.Component {
    constructor() {
        super();

        this.state = {
            showServiceModal: false,
            showZoneModal: false,
            firewall,
            pendingTarget: null /* `null` for not pending */,
            activeZone: null
        };

        this.onFirewallChanged = this.onFirewallChanged.bind(this);
        this.onSwitchChanged = this.onSwitchChanged.bind(this);
        this.onRemoveService = this.onRemoveService.bind(this);
        this.openServiceModal = this.openServiceModal.bind(this);
        this.closeServiceModal = this.closeServiceModal.bind(this);
        this.openZoneModal = this.openZoneModal.bind(this);
        this.closeZoneModal = this.closeZoneModal.bind(this);
    }

    onFirewallChanged() {
        this.setState((prevState) => {
            if (prevState.pendingTarget === firewall.enabled)
                return { firewall, pendingTarget: null };

            return { firewall };
        });
    }

    onSwitchChanged(value) {
        this.setState({ pendingTarget: value });

        if (value)
            firewall.enable();
        else
            firewall.disable();
    }

    onRemoveService(service) {
        firewall.removeService(service);
    }

    componentDidMount() {
        firewall.addEventListener("changed", this.onFirewallChanged);
    }

    componentWillUnmount() {
        firewall.removeEventListener("changed", this.onFirewallChanged);
    }

    closeServiceModal() {
        this.setState({ showServiceModal: false });
    }

    openServiceModal() {
        this.setState({ showServiceModal: true });
    }

    closeZoneModal() {
        this.setState({ showZoneModal: false });
    }

    openZoneModal(zone) {
        this.setState({ showZoneModal: true, activeZone: zone });
    }

    render() {
        function go_up(event) {
            if (!event || event.button !== 0)
                return;

            cockpit.jump("/network", cockpit.transport.host);
        }

        if (!this.state.firewall.installed) {
            return (
                <EmptyState title={_("Firewall is not available")} icon="fa fa-exclamation-circle">
                    <p>{cockpit.format(_("Please install the $0 package"), "firewalld")}</p>
                </EmptyState>
            );
        }

        var addServiceAction;
        if (this.state.firewall.readonly) {
            addServiceAction = (
                <OverlayTrigger className="pull-right" placement="top"
                                overlay={ <Tooltip id="tip-auth">{ _("You are not authorized to modify the firewall.") }</Tooltip> } >
                    <Button bsStyle="primary" className="pull-right" disabled> {_("Add Services…")} </Button>
                </OverlayTrigger>
            );
        } else {
            addServiceAction = (
                <Button bsStyle="primary" onClick={this.openServiceModal} className="pull-right">
                    {_("Add Services…")}
                </Button>
            );
        }

        var services = [...this.state.firewall.enabledServices].map(id => this.state.firewall.services[id]);
        services.sort((a, b) => a.name.localeCompare(b.name));
        services = services.filter(service => service !== undefined);

        var enabled = this.state.pendingTarget !== null ? this.state.pendingTarget : this.state.firewall.enabled;

        return (
            <div className="container-fluid page-ct">
                <ol className="breadcrumb">
                    <li><a onClick={go_up}>{_("Networking")}</a></li>
                    <li className="active">{_("Firewall")}</li>
                </ol>
                <h1>
                    {_("Firewall")}
                    <OnOffSwitch state={enabled}
                                 enabled={this.state.pendingTarget === null}
                                 onChange={this.onSwitchChanged} />
                </h1>
                { enabled &&
                    <>
                        <Listing title={_("Allowed Services")}
                            columnTitles={[ _("Service"), _("TCP"), _("UDP"), "" ]}
                            emptyCaption={_("No open ports")}
                            actions={addServiceAction}>
                            {
                                services.map(service => <ServiceRow key={service.id}
                                                            service={service}
                                                            readonly={this.state.firewall.readonly}
                                                            onRemoveService={this.onRemoveService} />)
                            }
                        </Listing>
                        <Listing title={_("Zones")}
                         columnTitles={[ _("Zone"), _("Interfaces"), "" ]}
                         emptyCaption={_("No zones")}>
                            {
                                Object.keys(firewall.zones).map(key => {
                                    const zone = firewall.zones[key];

                                    return (
                                        <ListingRow key={zone.name}
                                            rowId={zone.name}
                                            columns={[
                                                { name: zone.name, header: true },
                                                <div>
                                                    { JSON.stringify(zone.interfaces) }
                                                </div>,
                                                <button className="btn btn-info pficon pficon-edit" onClick={() => this.openZoneModal(zone)} />
                                            ]} />
                                    );
                                })
                            }
                        </Listing>
                    </>
                }
                { this.state.showServiceModal && <AddServicesBody close={this.closeServiceModal} /> }
                { this.state.showZoneModal && <ZonesBody close={this.closeZoneModal} zone={this.state.activeZone} /> }
            </div>
        );
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document.title = cockpit.gettext(document.title);

    ReactDOM.render(<Firewall />, document.getElementById("firewall"));
});
